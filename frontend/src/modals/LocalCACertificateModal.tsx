import { IconAlertTriangle } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import EasyModal, { type InnerModalProps } from "ez-modal-react";
import { Form } from "formik";
import { type ReactNode, useState } from "react";
import { Alert } from "react-bootstrap";
import Modal from "react-bootstrap/Modal";
import { createCertificate } from "src/api/backend";
import { Button, DomainNamesField } from "src/components";
import { FormModal } from "src/components/Form";
import { T } from "src/locale";
import { showObjectSuccess } from "src/notifications";

const showLocalCACertificateModal = () => {
	EasyModal.show(LocalCACertificateModal);
};

const LocalCACertificateModal = EasyModal.create(({ visible, remove }: InnerModalProps) => {
	const queryClient = useQueryClient();
	const [errorMsg, setErrorMsg] = useState<ReactNode | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const onSubmit = async (values: any, { setSubmitting }: any) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);

		try {
			await createCertificate(values);
			showObjectSuccess("certificate", "saved");
			remove();
		} catch (err: any) {
			setErrorMsg(<T id={err.message} />);
		}
		queryClient.invalidateQueries({ queryKey: ["certificates"] });
		setIsSubmitting(false);
		setSubmitting(false);
	};

	return (
		<FormModal
			show={visible}
			onHide={remove}
			preventHide={isSubmitting}
			initialValues={
				{
					domainNames: [],
					provider: "mkcert",
					meta: {},
				} as any
			}
			onSubmit={onSubmit}
		>
			{({ onHide }) => (
				<Form>
					<Modal.Header closeButton>
						<Modal.Title>
							<T id="object.add" tData={{ object: "certificates.local-ca" }} />
						</Modal.Title>
					</Modal.Header>
					<Modal.Body className="p-0">
						<Alert variant="danger" show={!!errorMsg} onClose={() => setErrorMsg(null)} dismissible>
							{errorMsg}
						</Alert>
						<div className="card m-0 border-0">
							<div className="card-body">
								<p className="text-warning">
									<IconAlertTriangle size={16} className="me-1" />
									<T id="certificates.local-ca.warning" />
								</p>
								<DomainNamesField isWildcardPermitted dnsProviderWildcardSupported />
								<p className="text-muted">
									<T id="certificates.local-ca.names-note" />
								</p>
							</div>
						</div>
					</Modal.Body>
					<Modal.Footer>
						<Button data-bs-dismiss="modal" onClick={onHide} disabled={isSubmitting}>
							<T id="cancel" />
						</Button>
						<div className="ms-auto">
							<Button
								type="submit"
								actionType="primary"
								className="bg-pink"
								data-bs-dismiss="modal"
								isLoading={isSubmitting}
								disabled={isSubmitting}
							>
								<T id="save" />
							</Button>
						</div>
					</Modal.Footer>
				</Form>
			)}
		</FormModal>
	);
});

export { showLocalCACertificateModal };
