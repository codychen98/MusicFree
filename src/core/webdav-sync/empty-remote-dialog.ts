import { showDialog } from "@/components/dialogs/useDialog";
import i18n from "@/core/i18n";

/** Blocking confirm before applying an empty remote overwrite (auto-sync bootstrap). */
export function confirmEmptyRemoteOverwrite(): Promise<boolean> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value: boolean): void => {
            if (settled) {
                return;
            }
            settled = true;
            resolve(value);
        };
        showDialog("SimpleDialog", {
            title: i18n.t("backupAndResume.emptyRemoteDialogTitle"),
            content: i18n.t("backupAndResume.emptyRemoteDialogBody"),
            onOk() {
                finish(true);
            },
            onDismissWithoutConfirm() {
                finish(false);
            },
        });
    });
}
