package com.occharacters;

/** Uses monotonic time supplied by the activity; resets after every decision to exit. */
final class BackExitGate {
    private long warnedAt = -1L;

    boolean press(long now) {
        if (warnedAt >= 0L && now >= warnedAt && now - warnedAt <= 2000L) {
            reset();
            return true;
        }
        warnedAt = now;
        return false;
    }

    void reset() { warnedAt = -1L; }
}
