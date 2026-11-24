import express from "express";
import dnsPlugins from "../../certbot/dns-plugins.json" with { type: "json" };
import internalCertificate from "../../internal/certificate.js";
import errs from "../../lib/error.js";
import jwtdecode from "../../lib/express/jwt-decode.js";
import apiValidator from "../../lib/validator/api.js";
import validator from "../../lib/validator/index.js";
import { debug, express as logger } from "../../logger.js";
import { getValidationSchema } from "../../schema/index.js";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

/**
 * /api/nginx/certificates
 */
router
	.route("/")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * GET /api/nginx/certificates
	 *
	 * Retrieve all certificates
	 */
	.get(async (req, res, next) => {
		try {
			const data = await validator(
				{
					additionalProperties: false,
					properties: {
						expand: {
							$ref: "common#/properties/expand",
						},
						query: {
							$ref: "common#/properties/query",
						},
					},
				},
				{
					expand: typeof req.query.expand === "string" ? req.query.expand.split(",") : null,
					query: typeof req.query.query === "string" ? req.query.query : null,
				},
			);
			const rows = await internalCertificate.getAll(res.locals.access, data.expand, data.query);
			res.status(200).send(rows);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	})

	/**
	 * POST /api/nginx/certificates
	 *
	 * Create a new certificate
	 */
	.post(async (req, res, next) => {
		try {
			const payload = await apiValidator(getValidationSchema("/nginx/certificates", "post"), req.body);
			req.setTimeout(900000); // 15 minutes timeout
			const result = await internalCertificate.create(res.locals.access, payload);
			res.status(201).send(result);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

/**
 * /api/nginx/certificates/dns-providers
 */
router
	.route("/dns-providers")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * GET /api/nginx/certificates/dns-providers
	 *
	 * Get list of all supported DNS providers
	 */
	.get(async (req, res, next) => {
		try {
			if (!res.locals.access.token.getUserId()) {
				throw new errs.PermissionError("Login required");
			}
			const clean = Object.keys(dnsPlugins).map((key) => ({
				id: key,
				name: dnsPlugins[key].name,
				credentials: dnsPlugins[key].credentials,
			}));

			clean.sort((a, b) => a.name.localeCompare(b.name));
			res.status(200).send(clean);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

/**
 * Test HTTP challenge for domains
 *
 * /api/nginx/certificates/test-http
 */
router
	.route("/test-http")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * POST /api/nginx/certificates/test-http
	 *
	 * Test HTTP challenge for domains
	 */
	.post(async (req, res, next) => {
		try {
			const payload = await apiValidator(getValidationSchema("/nginx/certificates/test-http", "post"), req.body);
			req.setTimeout(60000); // 1 minute timeout

			const result = await internalCertificate.testHttpsChallenge(res.locals.access, payload);
			res.status(200).send(result);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

/**
 * Validate Certs before saving
 *
 * /api/nginx/certificates/validate
 */
router
	.route("/validate")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * POST /api/nginx/certificates/validate
	 *
	 * Validate certificates
	 */
	.post(async (req, res, next) => {
		if (!req.files) {
			res.status(400).send({ error: "No files were uploaded" });
			return;
		}

		try {
			const result = await internalCertificate.validate(res.locals.access, {
				files: req.files,
			});
			res.status(200).send(result);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

/**
 * Local CA (mkcert)
 *
 * /api/nginx/certificates/local-ca
 *
 * Note: these routes must stay above the "/:certificate_id" route below, or
 * "local-ca" would be parsed as a certificate id.
 */
router
	.route("/local-ca")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * GET /api/nginx/certificates/local-ca
	 *
	 * Status of the Local CA: whether it exists, and the public details of its
	 * root certificate (fingerprint, subject, validity). The CA private key is
	 * never exposed.
	 */
	.get(async (req, res, next) => {
		try {
			const status = await internalCertificate.getLocalCAStatus(res.locals.access);
			res.status(200).send(status);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	})

	/**
	 * POST /api/nginx/certificates/local-ca
	 *
	 * Create the Local CA if it does not exist yet, then return its status.
	 */
	.post(async (req, res, next) => {
		try {
			const status = await internalCertificate.ensureLocalCA(res.locals.access);
			res.status(201).send(status);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

/**
 * Local CA root certificate download
 *
 * /api/nginx/certificates/local-ca/root-ca
 */
router
	.route("/local-ca/root-ca")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * GET /api/nginx/certificates/local-ca/root-ca
	 *
	 * Download the Local CA root certificate (public part) for installing on
	 * client devices. The CA private key is never served.
	 */
	.get(async (req, res, next) => {
		try {
			const pem = await internalCertificate.getLocalCARoot(res.locals.access);
			res.setHeader("Content-Disposition", 'attachment; filename="rootCA.pem"');
			res.status(200).type("application/x-pem-file").send(pem);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

/**
 * Specific certificate
 *
 * /api/nginx/certificates/123
 */
router
	.route("/:certificate_id")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * GET /api/nginx/certificates/123
	 *
	 * Retrieve a specific certificate
	 */
	.get(async (req, res, next) => {
		try {
			const data = await validator(
				{
					required: ["certificate_id"],
					additionalProperties: false,
					properties: {
						certificate_id: {
							$ref: "common#/properties/id",
						},
						expand: {
							$ref: "common#/properties/expand",
						},
					},
				},
				{
					certificate_id: req.params.certificate_id,
					expand: typeof req.query.expand === "string" ? req.query.expand.split(",") : null,
				},
			);
			const row = await internalCertificate.get(res.locals.access, {
				id: Number.parseInt(data.certificate_id, 10),
				expand: data.expand,
			});
			res.status(200).send(row);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	})

	/**
	 * DELETE /api/nginx/certificates/123
	 *
	 * Update and existing certificate
	 */
	.delete(async (req, res, next) => {
		try {
			const result = await internalCertificate.delete(res.locals.access, {
				id: Number.parseInt(req.params.certificate_id, 10),
			});
			res.status(200).send(result);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

/**
 * Upload Certs
 *
 * /api/nginx/certificates/123/upload
 */
router
	.route("/:certificate_id/upload")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * POST /api/nginx/certificates/123/upload
	 *
	 * Upload certificates
	 */
	.post(async (req, res, next) => {
		if (!req.files) {
			res.status(400).send({ error: "No files were uploaded" });
			return;
		}

		try {
			const result = await internalCertificate.upload(res.locals.access, {
				id: Number.parseInt(req.params.certificate_id, 10),
				files: req.files,
			});
			res.status(200).send(result);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

/**
 * Renew LE Certs
 *
 * /api/nginx/certificates/123/renew
 */
router
	.route("/:certificate_id/renew")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * POST /api/nginx/certificates/123/renew
	 *
	 * Renew certificate
	 */
	.post(async (req, res, next) => {
		req.setTimeout(900000); // 15 minutes timeout
		try {
			const result = await internalCertificate.renew(res.locals.access, {
				id: Number.parseInt(req.params.certificate_id, 10),
			});
			res.status(200).send(result);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

/**
 * Download LE Certs
 *
 * /api/nginx/certificates/123/download
 */
router
	.route("/:certificate_id/download")
	.options((_req, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * GET /api/nginx/certificates/123/download
	 *
	 * Renew certificate
	 */
	.get(async (req, res, next) => {
		try {
			const result = await internalCertificate.download(res.locals.access, {
				id: Number.parseInt(req.params.certificate_id, 10),
			});
			res.status(200).download(result.fileName);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

export default router;
