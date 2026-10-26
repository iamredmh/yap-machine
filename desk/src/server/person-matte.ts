import { spawnSync } from 'node:child_process';
import { release } from 'node:os';

export function personMatteCapabilities(): { personMatte: boolean; personMatteReason: string | null } {
    if (process.platform !== 'darwin')
        return { personMatte: false, personMatteReason: 'Automatic person cutouts need macOS 12 or later. Disable cutout effects to export on this computer; other effects and styles work here.' };
    // Darwin 21 is macOS 12, the first release with Vision person segmentation.
    if (Number.parseInt(release(), 10) < 21)
        return { personMatte: false, personMatteReason: 'Automatic person cutouts need macOS 12 or later. Update macOS or disable cutout effects to export.' };
    const tools = spawnSync('/usr/bin/xcrun', ['--find', 'swiftc'], { stdio: 'ignore', timeout: 5000 });
    if (tools.status !== 0)
        return { personMatte: false, personMatteReason: "Automatic person cutouts need Apple's Command Line Tools. Run xcode-select --install, then reopen Yap Machine." };
    return { personMatte: true, personMatteReason: null };
}
