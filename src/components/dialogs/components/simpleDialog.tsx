import React from "react";
import { hideDialog } from "../useDialog";
import Dialog from "./base";
import { useI18N } from "@/core/i18n";

interface ISimpleDialogProps {
    title: string;
    content: string | JSX.Element;
    okText?: string;
    cancelText?: string;
    onOk?: () => void;
    /** Invoked before hide when cancelling, closing via backdrop, or hardware back — not invoked on Confirm. */
    onDismissWithoutConfirm?: () => void;
}
export default function SimpleDialog(props: ISimpleDialogProps) {
    const { title, content, onOk, okText, cancelText, onDismissWithoutConfirm } =
        props;

    const { t } = useI18N();

    function dismissWithoutConfirm(): void {
        onDismissWithoutConfirm?.();
        hideDialog();
    }

    const actions = onOk
        ? [
            {
                title: cancelText ?? t("common.cancel"),
                type: "normal",
                onPress: dismissWithoutConfirm,
            },
            {
                title: okText ?? t("common.confirm"),
                type: "primary",
                onPress() {
                    onOk?.();
                    hideDialog();
                },
            },
        ]
        : ([
            {
                title: okText ?? t("dialog.errorLogKnow"),
                type: "primary",
                onPress() {
                    hideDialog();
                },
            },
        ] as any);

    return (
        <Dialog onDismiss={dismissWithoutConfirm}>
            <Dialog.Title withDivider>{title}</Dialog.Title>
            <Dialog.Content needScroll>{content}</Dialog.Content>
            <Dialog.Actions actions={actions} />
        </Dialog>
    );
}
