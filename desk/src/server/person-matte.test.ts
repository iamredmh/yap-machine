import { spawnSync } from 'node:child_process';
import { release } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { personMatteCapabilities } from './person-matte.js';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
vi.mock('node:os', () => ({ release: vi.fn() }));
beforeEach(() => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    vi.mocked(release).mockReturnValue('21.0.0');
    vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('native person cutout availability', () => {
    it('offers cutouts on macOS 12 and later when Apple tools resolve', () => {
        expect(personMatteCapabilities()).toEqual({ personMatte: true, personMatteReason: null });
        expect(spawnSync).toHaveBeenCalledWith('/usr/bin/xcrun', ['--find', 'swiftc'], expect.objectContaining({ timeout: 5000 }));
    });
    it('explains the Linux fallback without trying Apple tools', () => {
        vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
        expect(personMatteCapabilities()).toMatchObject({ personMatte: false, personMatteReason: expect.stringContaining('Disable cutout effects') });
        expect(spawnSync).not.toHaveBeenCalled();
    });
    it('does not offer unsupported macOS 11 segmentation', () => {
        vi.mocked(release).mockReturnValue('20.6.0');
        expect(personMatteCapabilities()).toMatchObject({ personMatte: false, personMatteReason: expect.stringContaining('macOS 12') });
        expect(spawnSync).not.toHaveBeenCalled();
    });
    it('explains how to install Apple tools when only the OS stub exists', () => {
        vi.mocked(spawnSync).mockReturnValue({ status: 1 } as ReturnType<typeof spawnSync>);
        expect(personMatteCapabilities()).toMatchObject({ personMatte: false, personMatteReason: expect.stringContaining('xcode-select --install') });
    });
});
