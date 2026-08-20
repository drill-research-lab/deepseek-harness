/**
 * A3 §5.5 directory-picker closure: no architecture in this repo currently
 * derives a safe, non-`UserHome`, user-facing browse root (`workspace.create`
 * and `directory-picker-browse` both accept arbitrary absolute paths with no
 * containment), so Drill production mounts this instead of
 * `dsh-host-directory-picker-auto`/`-native`/`-browse`. `packages/host/
 * apiproxy` hard-requires `ctx.directoryPicker` (`inject: ['directoryPicker',
 * ...]`), so the row cannot simply be `disabled: true` — something must
 * mount. Declaration-merging a new capability kind is the documented
 * extension point: "the union is merge-extensible, and the documented
 * default for an unknown kind is to hide the picking affordance rather than
 * fail" (`@deepseek-ai/dsh-host-directory-picker`'s module doc).
 *
 * Filed under `startup.ts`, not a package-specific basename: the repo's
 * `tsdown.config.ts` bundles only the fixed entry set
 * `{index,invariant,startup,file-session-store}`, and this bundle already
 * uses `index.ts` for its production-policy startup assertion.
 * @module @deepseek-ai/dsh-drill-production/startup
 */

import { DirectoryPicker } from '@deepseek-ai/dsh-host-directory-picker'
import type { DirectoryPickerCapabilities } from '@deepseek-ai/dsh-host-directory-picker'

/** The disabled interaction: no chooser, no browse — an unrecognized kind the client already hides. */
export interface DirectoryPickerDisabledCapability {
  kind: 'disabled'
}

declare module '@deepseek-ai/dsh-host-directory-picker' {
  interface DirectoryPickerCapabilities {
    disabled: DirectoryPickerDisabledCapability
  }
}

/** `ctx.directoryPicker` provider reporting an unrecognized capability kind — production has no safe browse root. */
export class DisabledDirectoryPicker extends DirectoryPicker {
  capability(): DirectoryPickerCapabilities['disabled'] {
    return { kind: 'disabled' }
  }
}

export default DisabledDirectoryPicker
