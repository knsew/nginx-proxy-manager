import * as api from "./base";

export async function downloadLocalCARoot(): Promise<void> {
	await api.download(
		{
			url: "/nginx/certificates/local-ca/root-ca",
		},
		"rootCA.pem",
	);
}
