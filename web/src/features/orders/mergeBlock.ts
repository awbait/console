// Why a change to a service could not be applied on its own.
//
// The cause is recorded in GitLab's vocabulary, one word per reason, and the
// sentence a person reads is written here. Shared by the order's history and by
// the notification about the same event, so both name the same cause the same
// way. Each phrase is written to be read after a colon: "Изменение не удалось
// применить: <phrase>".

const REASONS: Record<string, string> = {
  // The change was written against a version of the file that has since moved.
  conflict: "его правки разошлись с другим изменением этого сервиса",
  need_rebase: "его правки разошлись с другим изменением этого сервиса",
  broken_status: "его правки разошлись с другим изменением этого сервиса",
  // Gates a person opens.
  not_approved: "оно ждёт согласования",
  requested_changes: "проверяющий попросил доработать его",
  discussions_not_resolved: "в нём остались незакрытые обсуждения",
  draft_status: "оно помечено черновиком",
  blocked_status: "оно ждёт другое изменение",
  jira_association_missing: "в нём не указана задача",
  // Checks that have to pass.
  ci_must_pass: "его проверки не прошли",
  external_status_checks: "его внешние проверки не прошли",
  policies_denied: "оно не проходит правила безопасности",
  security_policy_violations: "оно не проходит правила безопасности",
  locked_paths: "его файлы заблокированы",
  locked_lfs_files: "его файлы заблокированы",
  // Reported only when the change has been stuck in one of these for a long
  // time: on their own they pass in seconds and nothing is said about them.
  checking: "проверка так и не завершилась",
  unchecked: "проверка так и не завершилась",
  preparing: "проверка так и не завершилась",
  approvals_syncing: "проверка так и не завершилась",
  ci_still_running: "его проверки так и не закончились",
  // The change is no longer open, so there is nothing left to apply.
  not_open: "оно уже закрыто",
};

// mergeBlockReason returns the phrase for a cause, or the cause itself when this
// build has never heard of it. Showing the raw word is deliberate: it is the
// only thing that lets anybody find out what happened, and a bare "не удалось
// применить" with nothing after it leaves the reader with no next step at all.
export function mergeBlockReason(reason: string): string {
  if (!reason) return "";
  return REASONS[reason] ?? reason;
}
