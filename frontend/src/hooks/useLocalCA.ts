import { useQuery } from "@tanstack/react-query";
import { type LocalCAStatus, getLocalCA } from "src/api/backend";

const useLocalCA = (options = {}) => {
	return useQuery<LocalCAStatus, Error>({
		queryKey: ["local-ca"],
		queryFn: () => getLocalCA(),
		staleTime: 60 * 1000,
		...options,
	});
};

export { useLocalCA };
