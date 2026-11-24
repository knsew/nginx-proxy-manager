import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import moment from "moment";
import error from "../lib/error.js";
import utils from "../lib/utils.js";
import { ssl as logger } from "../logger.js";

// The Local CA is a mkcert-managed CA that lives on the persisted /data volume,
// so it survives container recreates. Leaf certificates are issued by shelling
// out to the mkcert binary (no daemon, no network, no ACME): mkcert signs any
// name it is given, including private IPs and wildcards, and its certificates
// last ~825 days. Clients trust them only after the root certificate has been
// installed on the device once; that step is deliberately manual (see docs).
//
// The CA private key (rootCA-key.pem) can mint a certificate for any name this
// CA is trusted for. It is never served over the API, never logged, and never
// leaves /data except through a host-level backup of the volume.

// NPM_DATA_DIR exists for tests, which run against a temp directory instead of
// the container's /data volume. It is unset in production.
const getDataDir = () => process.env.NPM_DATA_DIR || "/data";

// MKCERT_CAROOT is the same variable mkcert itself reads, which keeps the CLI
// and this module in agreement about where the CA lives.
const getCaDir = () => process.env.MKCERT_CAROOT || path.join(getDataDir(), "mkcert");

// MKCERT_BIN exists for tests, which point at a downloaded binary instead of
// the one shipped in the image.
const getMkcertBin = () => process.env.MKCERT_BIN || "mkcert";

const getRootCertPath = () => path.join(getCaDir(), "rootCA.pem");
const getRootKeyPath = () => path.join(getCaDir(), "rootCA-key.pem");

// Leaf certificates live next to uploaded custom certificates, which the nginx
// templates already serve from /data/custom_ssl/npm-<id>/ for every provider
// that is not letsencrypt. Storing mkcert certificates there means no template
// changes are needed to serve them.
const getCertDir = (certificateId) => path.join(getDataDir(), "custom_ssl", `npm-${certificateId}`);

// mkcert invocations are serialised: CA creation in particular must not race
// with an issuance that assumes the CA already exists.
let queue = Promise.resolve();
const enqueue = (fn) => {
	const run = queue.then(fn, fn);
	queue = run.then(
		() => {},
		() => {},
	);
	return run;
};

const runMkcert = async (args) => {
	try {
		return await utils.execFile(getMkcertBin(), args, {
			env: { ...process.env, CAROOT: getCaDir() },
		});
	} catch (err) {
		// utils.execFile rejects with a CommandError carrying mkcert's stderr
		throw new error.ValidationError(`mkcert failed: ${err.message || err}`);
	}
};

// Creates the Local CA if it does not exist yet. mkcert has no "create the CA
// only" command: it creates the CA lazily on first issuance. So a throwaway
// certificate for localhost is issued and deleted again, which leaves just the
// CA behind. Callers must already hold the queue (see enqueue).
const createCAIfMissing = async () => {
	if (localCa.caExists()) {
		return;
	}

	const caDir = getCaDir();
	fs.mkdirSync(caDir, { recursive: true, mode: 0o700 });

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "npm-local-ca-"));
	try {
		await runMkcert([
			"-cert-file",
			path.join(tmpDir, "init.pem"),
			"-key-file",
			path.join(tmpDir, "init-key.pem"),
			"localhost",
		]);
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}

	if (!localCa.caExists()) {
		throw new error.ValidationError("mkcert did not create a local CA");
	}

	fs.chmodSync(getRootKeyPath(), 0o600);
	fs.chmodSync(getRootCertPath(), 0o644);
	logger.info(`Local CA created in ${caDir}`);
};

const localCa = {
	getCaDir,
	getCertDir,

	caExists: () => fs.existsSync(getRootCertPath()) && fs.existsSync(getRootKeyPath()),

	/**
	 * Creates the Local CA if it does not exist yet.
	 *
	 * @returns {Promise<Boolean>}  whether a CA exists afterwards
	 */
	ensureCA: async () => {
		return enqueue(async () => {
			await createCAIfMissing();
			return true;
		});
	},

	/**
	 * Status of the Local CA for the UI. Only public information is returned:
	 * the fingerprint, subject and validity of the root certificate. The CA
	 * private key is never read here, let alone returned.
	 *
	 * @returns {Promise<Object>}  { exists, fingerprint_sha256?, subject?, valid_from?, valid_to? }
	 */
	getStatus: async () => {
		if (!localCa.caExists()) {
			return { exists: false };
		}

		const certPath = getRootCertPath();
		const [fingerprintOut, datesOut, subjectOut] = await Promise.all([
			utils.execFile("openssl", ["x509", "-in", certPath, "-noout", "-fingerprint", "-sha256"]),
			utils.execFile("openssl", ["x509", "-in", certPath, "-noout", "-dates"]),
			utils.execFile("openssl", ["x509", "-in", certPath, "-noout", "-subject"]),
		]);

		const fingerprint = (fingerprintOut.split("=", 2)[1] || "").trim();
		const subject = subjectOut.replace(/^subject=\s*/i, "").trim();

		let validFrom = null;
		let validTo = null;
		for (const line of datesOut.split("\n")) {
			const match = /^(\S+)=(.*)$/.exec(line.trim());
			if (!match) {
				continue;
			}
			const date = moment(match[2], "MMM DD HH:mm:ss YYYY z").format("YYYY-MM-DD HH:mm:ss");
			if (match[1].toLowerCase() === "notbefore") {
				validFrom = date;
			} else if (match[1].toLowerCase() === "notafter") {
				validTo = date;
			}
		}

		return {
			exists: true,
			fingerprint_sha256: fingerprint,
			subject: subject,
			valid_from: validFrom,
			valid_to: validTo,
		};
	},

	/**
	 * The root certificate (public part) for clients to install. This is the
	 * only CA file that is ever served; the key has no read path at all.
	 *
	 * @returns {String}  PEM-encoded root certificate
	 */
	getRootCertPem: () => {
		const certPath = getRootCertPath();
		if (!fs.existsSync(certPath)) {
			throw new error.ItemNotFoundError("Local CA has not been created yet");
		}
		return fs.readFileSync(certPath, "utf8");
	},

	/**
	 * Issues (or re-issues) a leaf certificate for the given names. The CA is
	 * created first if it does not exist yet. Files are written to the same
	 * layout the nginx templates serve for custom certificates.
	 *
	 * @param   {Number}  certificateId
	 * @param   {String[]}  domainNames  hostnames, wildcards and/or IP addresses
	 * @returns {Promise<Object>}  { certificatePath, keyPath }
	 */
	issueCertificate: async (certificateId, domainNames) => {
		return enqueue(async () => {
			if (!Array.isArray(domainNames) || domainNames.length === 0) {
				throw new error.ValidationError("At least one domain name or IP address is required");
			}
			for (const name of domainNames) {
				// Names reach mkcert as argv (no shell), but one starting with a
				// dash would still be parsed as a flag. The request schema
				// already forbids most of this; this is defence in depth.
				if (typeof name !== "string" || name.length === 0 || name.startsWith("-") || /\s/.test(name)) {
					throw new error.ValidationError(`Invalid name for Local CA certificate: ${name}`);
				}
			}

			// Create the CA first if needed (same queue, so no extra serialisation).
			await createCAIfMissing();

			const dir = getCertDir(certificateId);
			fs.mkdirSync(dir, { recursive: true });
			const certPath = path.join(dir, "fullchain.pem");
			const keyPath = path.join(dir, "privkey.pem");

			logger.info(
				`Issuing Local CA (mkcert) certificate for Cert #${certificateId}: ${domainNames.join(", ")}`,
			);
			await runMkcert(["-cert-file", certPath, "-key-file", keyPath, ...domainNames]);

			fs.chmodSync(keyPath, 0o600);
			fs.chmodSync(certPath, 0o644);
			return { certificatePath: certPath, keyPath: keyPath };
		});
	},

	/**
	 * Removes one leaf certificate's files. Never throws, and never touches
	 * the CA itself: the CA is shared by every Local CA certificate.
	 *
	 * @param   {Number}  certificateId
	 * @returns {String[]}  paths that could not be removed
	 */
	removeCertificateFiles: (certificateId) => {
		const dir = getCertDir(certificateId);
		try {
			fs.rmSync(dir, { recursive: true, force: true });
			return [];
		} catch (err) {
			logger.error(`Could not remove Local CA certificate files in ${dir}: ${err.message}`);
			return [dir];
		}
	},
};

export default localCa;
