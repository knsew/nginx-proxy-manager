import * as api from "./base";
import type { LocalCAStatus } from "./models";

export async function getLocalCA(): Promise<LocalCAStatus> {
	return await api.get({
		url: "/nginx/certificates/local-ca",
	});
}
