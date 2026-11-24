import * as api from "./base";
import type { LocalCAStatus } from "./models";

export async function createLocalCA(): Promise<LocalCAStatus> {
	return await api.post({
		url: "/nginx/certificates/local-ca",
	});
}
