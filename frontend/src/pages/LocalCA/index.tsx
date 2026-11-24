import { IconDownload, IconShieldCheck } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Alert from "react-bootstrap/Alert";
import { createLocalCA, downloadLocalCARoot } from "src/api/backend";
import { Button, HasPermission, LoadingPage } from "src/components";
import { useLocaleState } from "src/context";
import { useLocalCA } from "src/hooks";
import { formatDateTime, T } from "src/locale";
import { CERTIFICATES, MANAGE, VIEW } from "src/modules/Permissions";
import { showError, showObjectSuccess } from "src/notifications";

const LocalCA = () => {
	const { locale } = useLocaleState();
	const queryClient = useQueryClient();
	const [isCreating, setIsCreating] = useState(false);
	const { isLoading, isError, error, data } = useLocalCA();

	if (isLoading) {
		return <LoadingPage />;
	}

	if (isError) {
		return <Alert variant="danger">{error?.message || "Unknown error"}</Alert>;
	}

	const handleCreate = async () => {
		if (isCreating) return;
		setIsCreating(true);
		try {
			await createLocalCA();
			showObjectSuccess("local-ca", "saved");
			queryClient.invalidateQueries({ queryKey: ["local-ca"] });
		} catch (err: any) {
			showError(err.message);
		}
		setIsCreating(false);
	};

	const handleDownload = async () => {
		try {
			await downloadLocalCARoot();
		} catch (err: any) {
			showError(err.message);
		}
	};

	return (
		<HasPermission section={CERTIFICATES} permission={VIEW} pageLoading loadingNoLogo>
			<div className="card mt-4">
				<div className="card-status-top bg-teal" />
				<div className="card-header">
					<h2 className="mt-1 mb-0">
						<IconShieldCheck size={20} className="me-2" />
						<T id="local-ca.title" />
					</h2>
				</div>
				<div className="card-body">
					<p className="text-muted">
						<T id="local-ca.description" />
					</p>

					{!data?.exists ? (
						<>
							<Alert variant="info">
								<T id="local-ca.not-created" />
							</Alert>
							<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
								<Button actionType="primary" className="bg-teal" onClick={handleCreate} isLoading={isCreating}>
									<T id="local-ca.create" />
								</Button>
							</HasPermission>
						</>
					) : (
						<>
							<table className="table table-bordered">
								<tbody>
									<tr>
										<td className="w-25">
											<T id="local-ca.subject" />
										</td>
										<td>
											<code>{data.subject}</code>
										</td>
									</tr>
									<tr>
										<td>
											<T id="local-ca.fingerprint" />
										</td>
										<td>
											<code className="text-break">{data.fingerprintSha256}</code>
										</td>
									</tr>
									<tr>
										<td>
											<T id="local-ca.valid-from" />
										</td>
										<td>{data.validFrom ? formatDateTime(data.validFrom, locale) : "N/A"}</td>
									</tr>
									<tr>
										<td>
											<T id="local-ca.valid-to" />
										</td>
										<td>{data.validTo ? formatDateTime(data.validTo, locale) : "N/A"}</td>
									</tr>
								</tbody>
							</table>

							<div className="mb-3">
								<Button actionType="primary" className="bg-teal" onClick={handleDownload}>
									<IconDownload size={16} className="me-1" />
									<T id="local-ca.download-root" />
								</Button>
							</div>

							<h3>
								<T id="local-ca.install.title" />
							</h3>
							<p className="text-muted">
								<T id="local-ca.install.intro" />
							</p>
							<h4>
								<T id="local-ca.install.windows.title" />
							</h4>
							<p>
								<T id="local-ca.install.windows.body" />
							</p>
							<h4>
								<T id="local-ca.install.macos.title" />
							</h4>
							<p>
								<T id="local-ca.install.macos.body" />
							</p>
							<h4>
								<T id="local-ca.install.linux.title" />
							</h4>
							<p>
								<T id="local-ca.install.linux.body" />
							</p>
							<h4>
								<T id="local-ca.install.ios.title" />
							</h4>
							<p>
								<T id="local-ca.install.ios.body" />
							</p>
							<h4>
								<T id="local-ca.install.android.title" />
							</h4>
							<p>
								<T id="local-ca.install.android.body" />
							</p>
							<Alert variant="warning">
								<T id="local-ca.install.warning" />
							</Alert>
						</>
					)}
				</div>
			</div>
		</HasPermission>
	);
};

export default LocalCA;
