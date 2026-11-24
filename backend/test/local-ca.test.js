/**
 * Local CA (mkcert) tests: CA creation, leaf issuance, status reporting and
 * file cleanup, through the real mkcert binary.
 *
 * The tests are skipped when no mkcert binary is available (MKCERT_BIN, or
 * `mkcert` on PATH): the binary is shipped in the Docker image but is not a
 * dependency of the backend itself, so CI without it must not fail.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const findMkcert = () => {
	if (process.env.MKCERT_BIN) {
		return process.env.MKCERT_BIN;
	}
	try {
		return execFileSync("which", ["mkcert"], { encoding: "utf8" }).trim() || null;
	} catch {
		return null;
	}
};

const MKCERT_BIN = findMkcert();

// Point the module at a temp data dir before importing it: the paths are read
// from the environment at call time, but the temp dir must exist first.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "npm-local-ca-test-"));
process.env.NPM_DATA_DIR = DATA_DIR;
if (MKCERT_BIN) {
	process.env.MKCERT_BIN = MKCERT_BIN;
}

const { default: localCa } = await import("../internal/local-ca.js");
import utils from "../lib/utils.js";

const openssl = (args) => utils.execFile("openssl", args);

describe("Local CA (mkcert)", { skip: !MKCERT_BIN }, () => {
	after(() => {
		fs.rmSync(DATA_DIR, { recursive: true, force: true });
	});

	it("reports no CA before one is created", async () => {
		assert.equal((await localCa.getStatus()).exists, false);
		assert.throws(() => localCa.getRootCertPem(), /not been created/);
	});

	it("creates a CA with a protected key", async () => {
		await localCa.ensureCA();
		const certPath = path.join(DATA_DIR, "mkcert", "rootCA.pem");
		const keyPath = path.join(DATA_DIR, "mkcert", "rootCA-key.pem");
		assert.ok(fs.existsSync(certPath));
		assert.ok(fs.existsSync(keyPath));
		assert.equal(fs.statSync(keyPath).mode & 0o777, 0o600);
	});

	it("does not rotate the CA when ensuring it again", async () => {
		const before = await localCa.getStatus();
		await localCa.ensureCA();
		const after = await localCa.getStatus();
		assert.equal(after.fingerprint_sha256, before.fingerprint_sha256);
	});

	it("reports status matching openssl", async () => {
		const status = await localCa.getStatus();
		assert.equal(status.exists, true);
		assert.match(status.fingerprint_sha256, /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/);
		assert.match(status.subject, /mkcert/);

		const fingerprint = await openssl([
			"x509",
			"-in",
			path.join(DATA_DIR, "mkcert", "rootCA.pem"),
			"-noout",
			"-fingerprint",
			"-sha256",
		]);
		assert.equal(fingerprint.split("=", 2)[1].trim(), status.fingerprint_sha256);

		// Root CA lasts 10 years
		const validTo = new Date(`${status.valid_to}Z`).getTime();
		const years = (validTo - Date.now()) / (365.25 * 24 * 3600 * 1000);
		assert.ok(years > 9 && years < 11, `root validity ${years} years`);
	});

	it("serves only the public root certificate, never the key", () => {
		const pem = localCa.getRootCertPem();
		assert.match(pem, /BEGIN CERTIFICATE/);
		assert.doesNotMatch(pem, /PRIVATE KEY/);
	});

	it("issues a certificate for domains, wildcards and IPs", async () => {
		const { certificatePath, keyPath } = await localCa.issueCertificate(1, [
			"example.test",
			"*.example.test",
			"10.1.1.52",
			"127.0.0.1",
		]);
		assert.ok(fs.existsSync(certificatePath));
		assert.ok(fs.existsSync(keyPath));
		assert.equal(fs.statSync(keyPath).mode & 0o777, 0o600);

		const text = await openssl(["x509", "-in", certificatePath, "-noout", "-text"]);
		assert.match(text, /DNS:example\.test/);
		assert.match(text, /DNS:\*\.example\.test/);
		assert.match(text, /IP Address:10\.1\.1\.52/);
		assert.match(text, /IP Address:127\.0\.0\.1/);

		// Leaf certificates last ~825 days (mkcert: 2 years and 3 months)
		const dates = await openssl(["x509", "-in", certificatePath, "-noout", "-dates", "-startdate", "-enddate"]);
		const end = /notAfter=(.*)/.exec(dates)[1];
		const days = (new Date(end).getTime() - Date.now()) / (24 * 3600 * 1000);
		assert.ok(days > 800 && days < 830, `leaf validity ${days} days`);
	});

	it("re-issues (renews) a certificate in place", async () => {
		const first = fs.readFileSync(path.join(DATA_DIR, "custom_ssl", "npm-1", "fullchain.pem"), "utf8");
		await localCa.issueCertificate(1, ["example.test", "10.1.1.52"]);
		const second = fs.readFileSync(path.join(DATA_DIR, "custom_ssl", "npm-1", "fullchain.pem"), "utf8");
		assert.notEqual(second, first);
	});

	it("rejects names that could be parsed as flags", async () => {
		await assert.rejects(localCa.issueCertificate(2, ["-evil"]), /Invalid name/);
		await assert.rejects(localCa.issueCertificate(2, []), /At least one/);
	});

	it("removes one certificate's files but never the CA", async () => {
		const leftover = localCa.removeCertificateFiles(1);
		assert.deepEqual(leftover, []);
		assert.ok(!fs.existsSync(path.join(DATA_DIR, "custom_ssl", "npm-1")));
		assert.equal(localCa.caExists(), true);
	});
});
