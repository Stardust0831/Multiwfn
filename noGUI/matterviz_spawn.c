#if !defined(_WIN32)
#if defined(__linux__) && !defined(_GNU_SOURCE)
#define _GNU_SOURCE 1
#endif
#define _POSIX_C_SOURCE 200809L
#endif

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#ifdef _WIN32
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0600
#endif
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#endif

#define MWFN_HEADER_BYTES 304U
#define MWFN_READY_BYTES 48U
#define MWFN_ACK_BYTES 64U
#define MWFN_MAX_SAMPLES UINT64_C(1500000)
#define MWFN_MAX_BODY_BYTES UINT64_C(12000000)
#define MWFN_MAX_FRAME_BYTES UINT64_C(12000304)
#define MWFN_READY_TIMEOUT_MS 15000U
#define MWFN_ERR_INVALID (-1001)
#define MWFN_ERR_PROTOCOL (-1002)
#define MWFN_ERR_TIMEOUT (-1003)
#define MWFN_ERR_HANDLE (-1004)
#define MWFN_ERR_REJECTED (-1005)
#define MWFN_ERR_UNSUPPORTED (-1006)
#define MWFN_STREAM_CHUNK_BYTES 65536U

static void mwfn_put_u16(uint8_t *dst, uint16_t value) {
    dst[0] = (uint8_t)(value & 0xffU);
    dst[1] = (uint8_t)(value >> 8);
}

static void mwfn_put_u32(uint8_t *dst, uint32_t value) {
    dst[0] = (uint8_t)(value & 0xffU);
    dst[1] = (uint8_t)((value >> 8) & 0xffU);
    dst[2] = (uint8_t)((value >> 16) & 0xffU);
    dst[3] = (uint8_t)(value >> 24);
}

static void mwfn_put_u64(uint8_t *dst, uint64_t value) {
    unsigned int index;
    for (index = 0; index < 8U; ++index) dst[index] = (uint8_t)(value >> (index * 8U));
}

static uint16_t mwfn_get_u16(const uint8_t *src) {
    return (uint16_t)src[0] | (uint16_t)((uint16_t)src[1] << 8);
}

static uint32_t mwfn_get_u32(const uint8_t *src) {
    return (uint32_t)src[0] | ((uint32_t)src[1] << 8) |
           ((uint32_t)src[2] << 16) | ((uint32_t)src[3] << 24);
}

static uint64_t mwfn_get_u64(const uint8_t *src) {
    uint64_t value = 0;
    unsigned int index;
    for (index = 0; index < 8U; ++index) value |= (uint64_t)src[index] << (index * 8U);
    return value;
}

static void mwfn_put_f64(uint8_t *dst, double value) {
    uint64_t bits;
    memcpy(&bits, &value, sizeof(bits));
    mwfn_put_u64(dst, bits);
}

static uint32_t mwfn_crc32c_update(uint32_t crc, const uint8_t *data, size_t length) {
    size_t index;
    for (index = 0; index < length; ++index) {
        unsigned int bit;
        crc ^= data[index];
        for (bit = 0; bit < 8U; ++bit) {
            const uint32_t mask = (uint32_t)-(int32_t)(crc & 1U);
            crc = (crc >> 1) ^ (UINT32_C(0x82f63b78) & mask);
        }
    }
    return crc;
}

static uint32_t mwfn_crc32c(const uint8_t *data, size_t length) {
    return ~mwfn_crc32c_update(UINT32_MAX, data, length);
}

static int mwfn_valid_ready(const uint8_t *header) {
    uint8_t copy[MWFN_READY_BYTES];
    if (memcmp(header, "MWFNVOL\0", 8U) != 0 || mwfn_get_u16(header + 8) != 1U ||
        mwfn_get_u16(header + 10) != 0U || mwfn_get_u16(header + 12) != 1U ||
        mwfn_get_u16(header + 14) != 1U || mwfn_get_u32(header + 16) != MWFN_READY_BYTES ||
        mwfn_get_u64(header + 20) != 0U || mwfn_get_u64(header + 28) != 0U ||
        mwfn_get_u32(header + 40) != 0U || mwfn_get_u32(header + 44) != 0U) {
        return 0;
    }
    memcpy(copy, header, sizeof(copy));
    memset(copy + 36, 0, 4U);
    return mwfn_crc32c(copy, sizeof(copy)) == mwfn_get_u32(header + 36);
}

static int mwfn_valid_ack_fields_major(const uint8_t *ack, uint16_t major,
                                       int64_t request_id, int64_t volume_id,
                                       int require_zero_status) {
    uint8_t copy[MWFN_ACK_BYTES];
    if (memcmp(ack, "MWFNVOL\0", 8U) != 0 || mwfn_get_u16(ack + 8) != major ||
        mwfn_get_u16(ack + 10) != 0U || mwfn_get_u16(ack + 12) != 8U ||
        mwfn_get_u16(ack + 14) != 1U || mwfn_get_u32(ack + 16) != MWFN_ACK_BYTES ||
        mwfn_get_u64(ack + 20) != (uint64_t)request_id || mwfn_get_u64(ack + 28) != 0U ||
        mwfn_get_u32(ack + 40) != 0U || mwfn_get_u32(ack + 44) != 0U ||
        mwfn_get_u64(ack + 48) != (uint64_t)volume_id ||
        mwfn_get_u32(ack + 60) != 0U) {
        return 0;
    }
    if (require_zero_status && mwfn_get_u32(ack + 56) != 0U) return 0;
    memcpy(copy, ack, sizeof(copy));
    memset(copy + 36, 0, 4U);
    return mwfn_crc32c(copy, sizeof(copy)) == mwfn_get_u32(ack + 36);
}

static int mwfn_valid_ack_fields(const uint8_t *ack, int64_t request_id, int64_t volume_id,
                                 int require_zero_status) {
    return mwfn_valid_ack_fields_major(ack, 1U, request_id, volume_id, require_zero_status);
}

static int mwfn_valid_ack(const uint8_t *ack, int64_t request_id, int64_t volume_id) {
    return mwfn_valid_ack_fields(ack, request_id, volume_id, 1);
}

static int mwfn_valid_stream_ack(const uint8_t *ack, int64_t request_id, int64_t volume_id) {
    return mwfn_valid_ack_fields_major(ack, 2U, request_id, volume_id, 1);
}

static int mwfn_host_is_little_endian(void) {
    const uint16_t marker = 1U;
    return *((const uint8_t *)&marker) == 1U;
}

static int mwfn_stream_shape(int32_t nx, int32_t ny, int32_t nz, int64_t sample_count,
                             uint64_t *count_out, uint64_t *body_bytes_out) {
    uint64_t count;
    if (count_out == NULL || body_bytes_out == NULL || nx <= 0 || ny <= 0 || nz <= 0 ||
        sample_count <= 0) {
        return EINVAL;
    }
    count = (uint64_t)(uint32_t)nx;
    if (count > UINT64_MAX / (uint64_t)(uint32_t)ny) return EOVERFLOW;
    count *= (uint64_t)(uint32_t)ny;
    if (count > UINT64_MAX / (uint64_t)(uint32_t)nz) return EOVERFLOW;
    count *= (uint64_t)(uint32_t)nz;
    if ((uint64_t)sample_count != count) return EINVAL;
    if (count > SIZE_MAX / sizeof(double)) return EOVERFLOW;
    if (count > UINT64_MAX / sizeof(double)) return EOVERFLOW;
    *count_out = count;
    *body_bytes_out = count * sizeof(double);
    return 0;
}

static int mwfn_build_volume(uint8_t **frame_out, size_t *frame_bytes_out,
                             int64_t request_id, int64_t volume_id, int32_t nx,
                             int32_t ny, int32_t nz, int32_t data_order,
                             int32_t periodic_axes, int32_t coordinate_unit,
                             int32_t quantity_kind, int32_t value_unit,
                             const double origin[3], const double voxel_axes[9],
                             const double lattice[9], const double *samples,
                             int64_t sample_count) {
    uint64_t count;
    uint64_t body_bytes;
    uint64_t frame_bytes;
    uint8_t *frame;
    uint8_t *body;
    double minimum = 0.0;
    double maximum = 0.0;
    double mean_sum = 0.0;
    double abs_max = 0.0;
    int sample_index;
    unsigned int index;

    if (frame_out == NULL || frame_bytes_out == NULL || request_id <= 0 || volume_id <= 0 ||
        nx <= 0 || ny <= 0 || nz <= 0 || data_order < 1 || data_order > 2 ||
        (periodic_axes & ~7) != 0 || (coordinate_unit != 1 && coordinate_unit != 2) ||
        (quantity_kind < 1 || quantity_kind > 3) ||
        ((quantity_kind == 1 && value_unit != 1) ||
         (quantity_kind == 2 && value_unit != 2) ||
         (quantity_kind == 3 && value_unit != 3)) || origin == NULL || voxel_axes == NULL ||
        lattice == NULL || samples == NULL || sample_count <= 0) {
        return EINVAL;
    }
    count = (uint64_t)(uint32_t)nx;
    if (count > MWFN_MAX_SAMPLES / (uint64_t)(uint32_t)ny) return EOVERFLOW;
    count *= (uint64_t)(uint32_t)ny;
    if (count > MWFN_MAX_SAMPLES / (uint64_t)(uint32_t)nz) return EOVERFLOW;
    count *= (uint64_t)(uint32_t)nz;
    if ((uint64_t)sample_count != count || count > MWFN_MAX_SAMPLES ||
        count > MWFN_MAX_BODY_BYTES / 8U) {
        return EINVAL;
    }
    body_bytes = count * 8U;
    frame_bytes = MWFN_HEADER_BYTES + body_bytes;
    if (frame_bytes > MWFN_MAX_FRAME_BYTES || frame_bytes > SIZE_MAX) return EOVERFLOW;
    for (index = 0; index < 3U; ++index) {
        if (!isfinite(origin[index])) return EINVAL;
    }
    for (index = 0; index < 9U; ++index) {
        if (!isfinite(voxel_axes[index]) || !isfinite(lattice[index])) return EINVAL;
    }

    frame = (uint8_t *)calloc(1U, (size_t)frame_bytes);
    if (frame == NULL) return ENOMEM;
    memcpy(frame, "MWFNVOL\0", 8U);
    mwfn_put_u16(frame + 8, 1U);
    mwfn_put_u16(frame + 10, 0U);
    mwfn_put_u16(frame + 12, 4U);
    mwfn_put_u16(frame + 14, 3U);
    mwfn_put_u32(frame + 16, MWFN_HEADER_BYTES);
    mwfn_put_u64(frame + 20, (uint64_t)request_id);
    mwfn_put_u64(frame + 28, body_bytes);
    mwfn_put_u64(frame + 48, (uint64_t)volume_id);
    mwfn_put_u32(frame + 56, (uint32_t)nx);
    mwfn_put_u32(frame + 60, (uint32_t)ny);
    mwfn_put_u32(frame + 64, (uint32_t)nz);
    frame[68] = 1U;
    frame[69] = 1U;
    frame[70] = (uint8_t)data_order;
    frame[71] = (uint8_t)periodic_axes;
    mwfn_put_u16(frame + 72, (uint16_t)coordinate_unit);
    mwfn_put_u16(frame + 74, (uint16_t)quantity_kind);
    mwfn_put_u16(frame + 76, (uint16_t)value_unit);
    for (index = 0; index < 3U; ++index) mwfn_put_f64(frame + 80U + index * 8U, origin[index]);
    for (index = 0; index < 9U; ++index) {
        mwfn_put_f64(frame + 104U + index * 8U, voxel_axes[index]);
        mwfn_put_f64(frame + 176U + index * 8U, lattice[index]);
    }
    mwfn_put_u64(frame + 248, count);
    mwfn_put_u64(frame + 256, body_bytes);

    body = frame + MWFN_HEADER_BYTES;
    for (sample_index = 0; (uint64_t)sample_index < count; ++sample_index) {
        const double value = samples[sample_index];
        if (!isfinite(value)) {
            free(frame);
            return EINVAL;
        }
        if (sample_index == 0) {
            minimum = value;
            maximum = value;
        } else {
            if (value < minimum) minimum = value;
            if (value > maximum) maximum = value;
        }
        mean_sum += value;
        if (!isfinite(mean_sum)) {
            free(frame);
            return EINVAL;
        }
        if (fabs(value) > abs_max) abs_max = fabs(value);
        mwfn_put_f64(body + (size_t)sample_index * 8U, value);
    }
    {
        const double mean = mean_sum / (double)count;
        if (!isfinite(minimum) || !isfinite(maximum) || !isfinite(mean) || !isfinite(abs_max)) {
            free(frame);
            return EINVAL;
        }
        mwfn_put_f64(frame + 264, minimum);
        mwfn_put_f64(frame + 272, maximum);
        mwfn_put_f64(frame + 280, mean);
        mwfn_put_f64(frame + 288, abs_max);
    }
    mwfn_put_u32(frame + 40, mwfn_crc32c(body, (size_t)body_bytes));
    mwfn_put_u32(frame + 36, mwfn_crc32c(frame, MWFN_HEADER_BYTES));
    *frame_out = frame;
    *frame_bytes_out = (size_t)frame_bytes;
    return 0;
}

#ifndef _WIN32

static int mwfn_set_cloexec(int fd, int enabled) {
    int flags = fcntl(fd, F_GETFD);
    if (flags < 0) return -1;
    if (enabled) flags |= FD_CLOEXEC;
    else flags &= ~FD_CLOEXEC;
    return fcntl(fd, F_SETFD, flags);
}

static int mwfn_pipe_cloexec(int fds[2]) {
#if defined(__linux__)
    if (pipe2(fds, O_CLOEXEC) == 0) return 0;
    if (errno != ENOSYS) return -1;
#endif
    if (pipe(fds) != 0) return -1;
    if (mwfn_set_cloexec(fds[0], 1) != 0 || mwfn_set_cloexec(fds[1], 1) != 0) {
        int saved = errno;
        close(fds[0]);
        close(fds[1]);
        fds[0] = -1;
        fds[1] = -1;
        errno = saved;
        return -1;
    }
    return 0;
}

static uint64_t mwfn_now_ms(void) {
    struct timespec now;
    if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) return 0;
    return (uint64_t)now.tv_sec * 1000U + (uint64_t)now.tv_nsec / 1000000U;
}

static int mwfn_read_exact_posix_deadline(int fd, void *buffer, size_t length,
                                          uint64_t deadline) {
    uint8_t *bytes = (uint8_t *)buffer;
    size_t offset = 0;
    while (offset < length) {
        struct pollfd descriptor;
        int wait_ms;
        ssize_t result;
        const uint64_t now = mwfn_now_ms();
        if (now >= deadline) return ETIMEDOUT;
        wait_ms = (int)(deadline - now);
        descriptor.fd = fd;
        descriptor.events = POLLIN;
        descriptor.revents = 0;
        result = poll(&descriptor, 1, wait_ms);
        if (result < 0 && errno == EINTR) continue;
        if (result < 0) return errno;
        if (result == 0) return ETIMEDOUT;
        do {
            result = read(fd, bytes + offset, length - offset);
        } while (result < 0 && errno == EINTR);
        if (result < 0) return errno;
        if (result == 0) return EPIPE;
        offset += (size_t)result;
    }
    return 0;
}

static int mwfn_read_exact_posix(int fd, void *buffer, size_t length,
                                 unsigned int timeout_ms) {
    return mwfn_read_exact_posix_deadline(fd, buffer, length, mwfn_now_ms() + timeout_ms);
}

static unsigned int mwfn_remaining_posix_ms(uint64_t deadline) {
    const uint64_t now = mwfn_now_ms();
    const uint64_t remaining = deadline > now ? deadline - now : 0U;
    return remaining > UINT32_MAX ? UINT32_MAX : (unsigned int)remaining;
}

static int mwfn_write_all_posix(int fd, const uint8_t *bytes, size_t length,
                                uint64_t deadline) {
    sigset_t set;
    sigset_t old_set;
    sigset_t pending_before;
    sigset_t pending_after;
    int original_flags;
    int error_code = 0;
    int masked = 0;
    size_t offset = 0;
    original_flags = fcntl(fd, F_GETFL);
    if (original_flags < 0) return errno;
    if ((original_flags & O_NONBLOCK) == 0 &&
        fcntl(fd, F_SETFL, original_flags | O_NONBLOCK) < 0) {
        return errno;
    }
    (void)sigemptyset(&pending_before);
    if (sigemptyset(&set) == 0 && sigaddset(&set, SIGPIPE) == 0 &&
        pthread_sigmask(SIG_BLOCK, &set, &old_set) == 0) {
        masked = 1;
        (void)sigpending(&pending_before);
    }
    while (offset < length) {
        struct pollfd descriptor;
        int poll_result;
        ssize_t result;
        const unsigned int remaining = mwfn_remaining_posix_ms(deadline);
        if (remaining == 0U) {
            error_code = ETIMEDOUT;
            break;
        }
        descriptor.fd = fd;
        descriptor.events = POLLOUT;
        descriptor.revents = 0;
        poll_result = poll(&descriptor, 1,
                           remaining > (unsigned int)INT_MAX ? INT_MAX : (int)remaining);
        if (poll_result < 0 && errno == EINTR) continue;
        if (poll_result < 0) {
            error_code = errno;
            break;
        }
        if (poll_result == 0) {
            error_code = ETIMEDOUT;
            break;
        }
        if ((descriptor.revents & (POLLERR | POLLHUP | POLLNVAL)) != 0) {
            error_code = EPIPE;
            break;
        }
        result = write(fd, bytes + offset, length - offset);
        if (result < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK)) continue;
        if (result <= 0) {
            error_code = errno == 0 ? EPIPE : errno;
            break;
        }
        offset += (size_t)result;
    }
    if (masked) {
        if (sigpending(&pending_after) == 0 &&
            !sigismember(&pending_before, SIGPIPE) && sigismember(&pending_after, SIGPIPE)) {
            int signal_number;
            (void)sigwait(&set, &signal_number);
        }
        (void)pthread_sigmask(SIG_SETMASK, &old_set, NULL);
    }
    if ((original_flags & O_NONBLOCK) == 0 && fcntl(fd, F_SETFL, original_flags) < 0 &&
        error_code == 0) {
        error_code = errno;
    }
    return error_code;
}

static void mwfn_close_fd(int *fd) {
    if (fd != NULL && *fd >= 0) {
        (void)close(*fd);
        *fd = -1;
    }
}

static void mwfn_reap_terminated(pid_t pid) {
    int status;
    unsigned int attempt;
    pid_t result = waitpid(pid, &status, WNOHANG);
    if (result == pid || (result < 0 && errno == ECHILD)) return;
    (void)kill(pid, SIGTERM);
    for (attempt = 0; attempt < 20U; ++attempt) {
        result = waitpid(pid, &status, WNOHANG);
        if (result == pid) return;
        if (result < 0 && errno == ECHILD) return;
        if (result < 0 && errno != EINTR) break;
        {
            struct timespec delay = {0, 50000000L};
            (void)nanosleep(&delay, NULL);
        }
    }
    (void)kill(pid, SIGKILL);
    do {
        if (waitpid(pid, &status, 0) == pid) return;
    } while (errno == EINTR);
}

static void *mwfn_reaper_thread(void *argument) {
    const pid_t pid = *(const pid_t *)argument;
    int status;
    free(argument);
    do {
        if (waitpid(pid, &status, 0) == pid) return NULL;
    } while (errno == EINTR);
    return NULL;
}

static int mwfn_register_reaper(pid_t pid) {
    pthread_t thread;
    pid_t *argument = (pid_t *)malloc(sizeof(*argument));
    int error_code;
    if (argument == NULL) return ENOMEM;
    *argument = pid;
    error_code = pthread_create(&thread, NULL, mwfn_reaper_thread, argument);
    if (error_code != 0) {
        free(argument);
        return error_code;
    }
    error_code = pthread_detach(thread);
    if (error_code != 0) {
        (void)pthread_join(thread, NULL);
        return 0;
    }
    return 0;
}

static int mwfn_spawn_posix(const char *executable, const char *frontend, const char *session,
                            const char *manifest, int with_transport, pid_t *pid_out,
                            int *volume_write_out, int *ack_read_out) {
    int volume_pipe[2] = {-1, -1};
    int ack_pipe[2] = {-1, -1};
    int exec_pipe[2] = {-1, -1};
    pid_t pid;
    char volume_fd[32];
    char ack_fd[32];
    char *argv[14];
    unsigned int argc = 0;
    int error_code;
    if (mwfn_pipe_cloexec(exec_pipe) != 0 ||
        (with_transport && (mwfn_pipe_cloexec(volume_pipe) != 0 ||
                            mwfn_pipe_cloexec(ack_pipe) != 0))) {
        error_code = errno == 0 ? EIO : errno;
        mwfn_close_fd(&exec_pipe[0]);
        mwfn_close_fd(&exec_pipe[1]);
        mwfn_close_fd(&volume_pipe[0]);
        mwfn_close_fd(&volume_pipe[1]);
        mwfn_close_fd(&ack_pipe[0]);
        mwfn_close_fd(&ack_pipe[1]);
        return error_code;
    }
    argv[argc++] = (char *)executable;
    argv[argc++] = (char *)"--frontend";
    argv[argc++] = (char *)frontend;
    argv[argc++] = (char *)"--session";
    argv[argc++] = (char *)session;
    argv[argc++] = (char *)"--manifest";
    argv[argc++] = (char *)manifest;
    if (with_transport) {
        (void)snprintf(volume_fd, sizeof(volume_fd), "%d", volume_pipe[0]);
        (void)snprintf(ack_fd, sizeof(ack_fd), "%d", ack_pipe[1]);
        argv[argc++] = (char *)"--volume-read-pipe";
        argv[argc++] = volume_fd;
        argv[argc++] = (char *)"--volume-ack-pipe";
        argv[argc++] = ack_fd;
    }
    argv[argc] = NULL;
    pid = fork();
    if (pid < 0) {
        error_code = errno;
        mwfn_close_fd(&exec_pipe[0]);
        mwfn_close_fd(&exec_pipe[1]);
        mwfn_close_fd(&volume_pipe[0]);
        mwfn_close_fd(&volume_pipe[1]);
        mwfn_close_fd(&ack_pipe[0]);
        mwfn_close_fd(&ack_pipe[1]);
        return error_code;
    }
    if (pid == 0) {
        int exec_error;
        mwfn_close_fd(&exec_pipe[0]);
        if (with_transport) {
            mwfn_close_fd(&volume_pipe[1]);
            mwfn_close_fd(&ack_pipe[0]);
            (void)mwfn_set_cloexec(volume_pipe[0], 0);
            (void)mwfn_set_cloexec(ack_pipe[1], 0);
        }
        execv(executable, argv);
        exec_error = errno == 0 ? EIO : errno;
        while (write(exec_pipe[1], &exec_error, sizeof(exec_error)) < 0 && errno == EINTR) {
        }
        _exit(127);
    }
    mwfn_close_fd(&exec_pipe[1]);
    {
        int exec_error = 0;
        ssize_t read_bytes;
        do {
            read_bytes = read(exec_pipe[0], &exec_error, sizeof(exec_error));
        } while (read_bytes < 0 && errno == EINTR);
        mwfn_close_fd(&exec_pipe[0]);
        if (read_bytes != 0) {
            int status;
            error_code = read_bytes == (ssize_t)sizeof(exec_error) && exec_error != 0
                             ? exec_error
                             : EIO;
            mwfn_close_fd(&volume_pipe[0]);
            mwfn_close_fd(&volume_pipe[1]);
            mwfn_close_fd(&ack_pipe[0]);
            mwfn_close_fd(&ack_pipe[1]);
            do {
                read_bytes = waitpid(pid, &status, 0);
            } while (read_bytes < 0 && errno == EINTR);
            return error_code;
        }
    }
    if (with_transport) {
        mwfn_close_fd(&volume_pipe[0]);
        mwfn_close_fd(&ack_pipe[1]);
        *volume_write_out = volume_pipe[1];
        *ack_read_out = ack_pipe[0];
    }
    *pid_out = pid;
    return 0;
}

static int mwfn_spawn_file_only_posix(const char *executable, const char *frontend,
                                      const char *session, const char *manifest,
                                      pid_t *pid_out) {
    int unused_volume = -1;
    int unused_ack = -1;
    return mwfn_spawn_posix(executable, frontend, session, manifest, 0, pid_out,
                            &unused_volume, &unused_ack);
}

/* Launch the packaged Rust file chooser without involving a shell and wait for it. */
static int mwfn_select_file_posix(const char *executable, const char *output) {
    int exec_pipe[2] = {-1, -1};
    const char *argv[5];
    pid_t pid;
    int status;
    int exec_error = 0;
    ssize_t read_bytes;
    int error_code;
    if (executable == NULL || output == NULL || executable[0] == '\0' || output[0] == '\0') {
        return EINVAL;
    }
    if (mwfn_pipe_cloexec(exec_pipe) != 0) return errno == 0 ? EIO : errno;
    argv[0] = executable;
    argv[1] = "--select-file";
    argv[2] = "--output";
    argv[3] = output;
    argv[4] = NULL;
    pid = fork();
    if (pid < 0) {
        error_code = errno;
        mwfn_close_fd(&exec_pipe[0]);
        mwfn_close_fd(&exec_pipe[1]);
        return error_code;
    }
    if (pid == 0) {
        mwfn_close_fd(&exec_pipe[0]);
        execv(executable, (char *const *)argv);
        exec_error = errno == 0 ? EIO : errno;
        while (write(exec_pipe[1], &exec_error, sizeof(exec_error)) < 0 && errno == EINTR) {
        }
        _exit(127);
    }
    mwfn_close_fd(&exec_pipe[1]);
    do {
        read_bytes = read(exec_pipe[0], &exec_error, sizeof(exec_error));
    } while (read_bytes < 0 && errno == EINTR);
    mwfn_close_fd(&exec_pipe[0]);
    do {
        error_code = (int)waitpid(pid, &status, 0);
    } while (error_code < 0 && errno == EINTR);
    if (error_code < 0) return errno == 0 ? ECHILD : errno;
    if (read_bytes > 0) return read_bytes == (ssize_t)sizeof(exec_error) ? exec_error : EIO;
    if (WIFEXITED(status)) return WEXITSTATUS(status) == 0 ? 0 : 200 + WEXITSTATUS(status);
    if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
    return ECHILD;
}

static int mwfn_clear_stop_flag_posix(const char *session) {
    const char suffix[] = "/gui_stop.flag";
    const size_t session_length = strlen(session);
    char *path;
    int error_code = 0;
    if (session_length > SIZE_MAX - sizeof(suffix)) return ENAMETOOLONG;
    path = (char *)malloc(session_length + sizeof(suffix));
    if (path == NULL) return ENOMEM;
    memcpy(path, session, session_length);
    memcpy(path + session_length, suffix, sizeof(suffix));
    if (unlink(path) != 0 && errno != ENOENT) error_code = errno;
    free(path);
    return error_code;
}

#else

static wchar_t *mwfn_utf8_to_wide(const char *value) {
    int length;
    wchar_t *wide;
    if (value == NULL) return NULL;
    length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value, -1, NULL, 0);
    if (length <= 0) return NULL;
    wide = (wchar_t *)malloc((size_t)length * sizeof(wchar_t));
    if (wide == NULL) return NULL;
    if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value, -1, wide, length) <= 0) {
        free(wide);
        return NULL;
    }
    return wide;
}

static int mwfn_clear_stop_flag_windows(const char *session) {
    static const wchar_t suffix[] = L"\\gui_stop.flag";
    wchar_t *wide_session = mwfn_utf8_to_wide(session);
    wchar_t *path;
    size_t session_length;
    size_t suffix_length = sizeof(suffix) / sizeof(suffix[0]);
    DWORD error_code = 0;
    if (wide_session == NULL) return ERROR_NO_UNICODE_TRANSLATION;
    session_length = wcslen(wide_session);
    if (session_length > SIZE_MAX / sizeof(wchar_t) - suffix_length) {
        free(wide_session);
        return ERROR_FILENAME_EXCED_RANGE;
    }
    path = (wchar_t *)malloc((session_length + suffix_length) * sizeof(wchar_t));
    if (path == NULL) {
        free(wide_session);
        return ERROR_NOT_ENOUGH_MEMORY;
    }
    memcpy(path, wide_session, session_length * sizeof(wchar_t));
    memcpy(path + session_length, suffix, suffix_length * sizeof(wchar_t));
    if (!DeleteFileW(path)) {
        error_code = GetLastError();
        if (error_code == ERROR_FILE_NOT_FOUND || error_code == ERROR_PATH_NOT_FOUND) error_code = 0;
    }
    free(path);
    free(wide_session);
    return (int)error_code;
}

static HANDLE mwfn_inheritable_std_handle(DWORD std_id, DWORD null_access) {
    HANDLE source = GetStdHandle(std_id);
    HANDLE duplicate = NULL;
    SECURITY_ATTRIBUTES security = {sizeof(SECURITY_ATTRIBUTES), NULL, TRUE};
    if (source != NULL && source != INVALID_HANDLE_VALUE &&
        DuplicateHandle(GetCurrentProcess(), source, GetCurrentProcess(), &duplicate, 0, TRUE,
                        DUPLICATE_SAME_ACCESS)) {
        return duplicate;
    }
    return CreateFileW(
        L"NUL", null_access, FILE_SHARE_READ | FILE_SHARE_WRITE, &security,
        OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
}

static void mwfn_close_handle(HANDLE *handle) {
    if (handle != NULL && *handle != NULL && *handle != INVALID_HANDLE_VALUE) {
        (void)CloseHandle(*handle);
        *handle = NULL;
    }
}

static int mwfn_append_wide(wchar_t **buffer, size_t *length, size_t *capacity,
                            const wchar_t *text) {
    size_t index;
    size_t needed = *length + 3U;
    for (index = 0; text[index] != L'\0';) {
        if (text[index] == L'\\') {
            size_t run = 0;
            while (text[index + run] == L'\\') ++run;
            if (text[index + run] == L'"' || text[index + run] == L'\0') {
                needed += run * 2U;
                if (text[index + run] == L'"') needed += 2U;
            } else {
                needed += run;
            }
            index += run;
        } else {
            needed += text[index] == L'"' ? 2U : 1U;
            ++index;
        }
    }
    if (needed > *capacity) {
        size_t next = *capacity == 0 ? 256U : *capacity;
        while (next < needed) {
            if (next > SIZE_MAX / 2U) return ENOMEM;
            next *= 2U;
        }
        {
            wchar_t *grown = (wchar_t *)realloc(*buffer, next * sizeof(wchar_t));
            if (grown == NULL) return ENOMEM;
            *buffer = grown;
            *capacity = next;
        }
    }
    (*buffer)[(*length)++] = L'"';
    for (index = 0; text[index] != L'\0';) {
        if (text[index] == L'\\') {
            size_t run = 0;
            while (text[index + run] == L'\\') ++run;
            const size_t run_length = run;
            if (text[index + run] == L'"') {
                size_t count = run * 2U;
                while (count-- != 0U) (*buffer)[(*length)++] = L'\\';
                (*buffer)[(*length)++] = L'\\';
                (*buffer)[(*length)++] = L'"';
                index += run + 1U;
            } else if (text[index + run] == L'\0') {
                size_t count = run * 2U;
                while (count-- != 0U) (*buffer)[(*length)++] = L'\\';
                index += run;
            } else {
                while (run-- != 0U) (*buffer)[(*length)++] = L'\\';
                index += run_length;
            }
        } else {
            if (text[index] == L'"') (*buffer)[(*length)++] = L'\\';
            (*buffer)[(*length)++] = text[index++];
        }
    }
    (*buffer)[(*length)++] = L'"';
    (*buffer)[(*length)++] = L' ';
    (*buffer)[*length] = L'\0';
    return 0;
}

static int mwfn_read_exact_win_deadline(HANDLE handle, void *buffer, DWORD length,
                                        ULONGLONG deadline) {
    uint8_t *bytes = (uint8_t *)buffer;
    DWORD offset = 0;
    while (offset < length) {
        DWORD available = 0;
        DWORD read_bytes = 0;
        if (!PeekNamedPipe(handle, NULL, 0, NULL, &available, NULL)) return (int)GetLastError();
        if (available == 0) {
            if (GetTickCount64() >= deadline) return ETIMEDOUT;
            Sleep(1);
            continue;
        }
        if (!ReadFile(handle, bytes + offset, length - offset, &read_bytes, NULL)) {
            return (int)GetLastError();
        }
        if (read_bytes == 0) return ERROR_BROKEN_PIPE;
        offset += read_bytes;
    }
    return 0;
}

static int mwfn_read_exact_win(HANDLE handle, void *buffer, DWORD length,
                               unsigned int timeout_ms) {
    return mwfn_read_exact_win_deadline(handle, buffer, length, GetTickCount64() + timeout_ms);
}

typedef struct {
    HANDLE done_event;
    HANDLE target_thread;
    DWORD timeout_ms;
    volatile LONG timed_out;
} mwfn_write_watchdog;

static DWORD WINAPI mwfn_write_watchdog_main(void *argument) {
    mwfn_write_watchdog *watchdog = (mwfn_write_watchdog *)argument;
    if (WaitForSingleObject(watchdog->done_event, watchdog->timeout_ms) == WAIT_TIMEOUT) {
        (void)InterlockedExchange(&watchdog->timed_out, 1);
        while (WaitForSingleObject(watchdog->done_event, 0) == WAIT_TIMEOUT) {
            if (CancelSynchronousIo(watchdog->target_thread)) break;
            if (GetLastError() != ERROR_NOT_FOUND) break;
            Sleep(1);
        }
    }
    return 0;
}

static DWORD mwfn_remaining_win_ms(ULONGLONG deadline) {
    const ULONGLONG now = GetTickCount64();
    const ULONGLONG remaining = deadline > now ? deadline - now : 0U;
    return remaining > UINT32_MAX ? UINT32_MAX : (DWORD)remaining;
}

static int mwfn_write_all_win(HANDLE handle, const uint8_t *bytes, size_t length,
                              ULONGLONG deadline) {
    mwfn_write_watchdog watchdog = {0};
    HANDLE watchdog_thread = NULL;
    int error_code = 0;
    size_t offset = 0;
    watchdog.timeout_ms = mwfn_remaining_win_ms(deadline);
    if (watchdog.timeout_ms == 0U) return ETIMEDOUT;
    watchdog.done_event = CreateEventW(NULL, TRUE, FALSE, NULL);
    if (watchdog.done_event == NULL) return (int)GetLastError();
    if (!DuplicateHandle(GetCurrentProcess(), GetCurrentThread(), GetCurrentProcess(),
                         &watchdog.target_thread, 0, FALSE, DUPLICATE_SAME_ACCESS)) {
        error_code = (int)GetLastError();
        CloseHandle(watchdog.done_event);
        return error_code;
    }
    watchdog_thread = CreateThread(NULL, 0, mwfn_write_watchdog_main, &watchdog, 0, NULL);
    if (watchdog_thread == NULL) {
        error_code = (int)GetLastError();
        CloseHandle(watchdog.target_thread);
        CloseHandle(watchdog.done_event);
        return error_code;
    }
    while (offset < length) {
        DWORD written = 0;
        DWORD portion = (DWORD)((length - offset) > UINT32_MAX ? UINT32_MAX : length - offset);
        if (InterlockedCompareExchange(&watchdog.timed_out, 0, 0) != 0 ||
            mwfn_remaining_win_ms(deadline) == 0U) {
            error_code = ETIMEDOUT;
            break;
        }
        if (!WriteFile(handle, bytes + offset, portion, &written, NULL)) {
            error_code = (int)GetLastError();
            break;
        }
        if (written == 0) {
            error_code = ERROR_BROKEN_PIPE;
            break;
        }
        offset += written;
    }
    (void)SetEvent(watchdog.done_event);
    (void)WaitForSingleObject(watchdog_thread, INFINITE);
    CloseHandle(watchdog_thread);
    CloseHandle(watchdog.target_thread);
    CloseHandle(watchdog.done_event);
    if (InterlockedCompareExchange(&watchdog.timed_out, 0, 0) != 0) return ETIMEDOUT;
    return error_code;
}

static int mwfn_select_file_windows(const char *executable, const char *output) {
    const char *names[4];
    wchar_t *wide_values[4] = {NULL, NULL, NULL, NULL};
    wchar_t *command_line = NULL;
    size_t command_length = 0;
    size_t command_capacity = 0;
    STARTUPINFOW startup = {0};
    PROCESS_INFORMATION process = {0};
    DWORD wait_result;
    DWORD exit_code = 0;
    int error_code = 0;
    unsigned int index;
    if (executable == NULL || output == NULL || executable[0] == '\0' || output[0] == '\0') {
        return ERROR_INVALID_PARAMETER;
    }
    names[0] = executable;
    names[1] = "--select-file";
    names[2] = "--output";
    names[3] = output;
    for (index = 0; index < 4U; ++index) {
        wide_values[index] = mwfn_utf8_to_wide(names[index]);
        if (wide_values[index] == NULL) {
            error_code = ERROR_NO_UNICODE_TRANSLATION;
            goto cleanup;
        }
        error_code = mwfn_append_wide(&command_line, &command_length, &command_capacity,
                                      wide_values[index]);
        if (error_code != 0) goto cleanup;
    }
    startup.cb = sizeof(startup);
    if (!CreateProcessW(wide_values[0], command_line, NULL, NULL, FALSE, 0, NULL, NULL,
                        &startup, &process)) {
        error_code = (int)GetLastError();
        goto cleanup;
    }
    wait_result = WaitForSingleObject(process.hProcess, INFINITE);
    if (wait_result != WAIT_OBJECT_0) {
        error_code = wait_result == WAIT_FAILED ? (int)GetLastError() : ERROR_GEN_FAILURE;
        goto cleanup;
    }
    if (!GetExitCodeProcess(process.hProcess, &exit_code)) {
        error_code = (int)GetLastError();
        goto cleanup;
    }
    error_code = exit_code == 0U ? 0 : (exit_code > 127U ? 127 : (int)exit_code + 200);

cleanup:
    if (process.hThread != NULL) CloseHandle(process.hThread);
    if (process.hProcess != NULL) CloseHandle(process.hProcess);
    free(command_line);
    for (index = 0; index < 4U; ++index) free(wide_values[index]);
    return error_code;
}

static int mwfn_spawn_windows(const char *executable, const char *frontend, const char *session,
                              const char *manifest, int with_transport, HANDLE *volume_write_out,
                              HANDLE *ack_read_out, PROCESS_INFORMATION *process_out) {
    const char *names[11];
    char volume_handle[32];
    char ack_handle[32];
    wchar_t *wide_values[11] = {0};
    wchar_t *command_line = NULL;
    size_t command_length = 0;
    size_t command_capacity = 0;
    unsigned int count = 0;
    SECURITY_ATTRIBUTES security = {sizeof(SECURITY_ATTRIBUTES), NULL, TRUE};
    HANDLE volume_read = NULL;
    HANDLE volume_write = NULL;
    HANDLE ack_read = NULL;
    HANDLE ack_write = NULL;
    HANDLE inherited[5] = {NULL, NULL, NULL, NULL, NULL};
    STARTUPINFOEXW startup = {0};
    PROCESS_INFORMATION process = {0};
    LPPROC_THREAD_ATTRIBUTE_LIST attributes = NULL;
    SIZE_T attributes_size = 0;
    int error_code = 0;
    unsigned int index;
    names[count++] = executable;
    names[count++] = "--frontend";
    names[count++] = frontend;
    names[count++] = "--session";
    names[count++] = session;
    names[count++] = "--manifest";
    names[count++] = manifest;
    if (with_transport) {
        if (!CreatePipe(&volume_read, &volume_write, &security, 0) ||
            !CreatePipe(&ack_read, &ack_write, &security, 0)) {
            error_code = (int)GetLastError();
            goto cleanup;
        }
        if (!SetHandleInformation(volume_write, HANDLE_FLAG_INHERIT, 0) ||
            !SetHandleInformation(ack_read, HANDLE_FLAG_INHERIT, 0)) {
            error_code = (int)GetLastError();
            goto cleanup;
        }
        (void)snprintf(volume_handle, sizeof(volume_handle), "%llu",
                       (unsigned long long)(uintptr_t)volume_read);
        (void)snprintf(ack_handle, sizeof(ack_handle), "%llu",
                       (unsigned long long)(uintptr_t)ack_write);
        names[count++] = "--volume-read-pipe";
        names[count++] = volume_handle;
        names[count++] = "--volume-ack-pipe";
        names[count++] = ack_handle;
    }
    for (index = 0; index < count; ++index) {
        wide_values[index] = mwfn_utf8_to_wide(names[index]);
        if (wide_values[index] == NULL) {
            error_code = ERROR_NO_UNICODE_TRANSLATION;
            goto cleanup;
        }
        error_code = mwfn_append_wide(&command_line, &command_length, &command_capacity,
                                      wide_values[index]);
        if (error_code != 0) goto cleanup;
    }
    inherited[0] = mwfn_inheritable_std_handle(STD_INPUT_HANDLE, GENERIC_READ);
    inherited[1] = mwfn_inheritable_std_handle(STD_OUTPUT_HANDLE, GENERIC_WRITE);
    inherited[2] = mwfn_inheritable_std_handle(STD_ERROR_HANDLE, GENERIC_WRITE);
    if (inherited[0] == NULL || inherited[0] == INVALID_HANDLE_VALUE ||
        inherited[1] == NULL || inherited[1] == INVALID_HANDLE_VALUE ||
        inherited[2] == NULL || inherited[2] == INVALID_HANDLE_VALUE) {
        error_code = (int)GetLastError();
        goto cleanup;
    }
    {
        const SIZE_T inherited_count = with_transport ? 5U : 3U;
        inherited[3] = with_transport ? volume_read : NULL;
        inherited[4] = with_transport ? ack_write : NULL;
        startup.StartupInfo.hStdInput = inherited[0];
        startup.StartupInfo.hStdOutput = inherited[1];
        startup.StartupInfo.hStdError = inherited[2];
        InitializeProcThreadAttributeList(NULL, 1, 0, &attributes_size);
        attributes = (LPPROC_THREAD_ATTRIBUTE_LIST)malloc(attributes_size);
        if (attributes == NULL) {
            error_code = ERROR_NOT_ENOUGH_MEMORY;
            goto cleanup;
        }
        if (!InitializeProcThreadAttributeList(attributes, 1, 0, &attributes_size) ||
            !UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                                       inherited, inherited_count * sizeof(HANDLE), NULL, NULL)) {
            error_code = (int)GetLastError();
            goto cleanup;
        }
        startup.lpAttributeList = attributes;
    }
    startup.StartupInfo.cb = sizeof(startup);
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    if (!CreateProcessW(wide_values[0], command_line, NULL, NULL, TRUE,
                        EXTENDED_STARTUPINFO_PRESENT, NULL, NULL,
                        &startup.StartupInfo, &process)) {
        error_code = (int)GetLastError();
        goto cleanup;
    }
    if (with_transport) {
        CloseHandle(volume_read);
        volume_read = NULL;
        CloseHandle(ack_write);
        ack_write = NULL;
        *volume_write_out = volume_write;
        *ack_read_out = ack_read;
        volume_write = NULL;
        ack_read = NULL;
    }
    *process_out = process;
    process.hProcess = NULL;
    process.hThread = NULL;
    error_code = 0;

cleanup:
    if (process.hThread != NULL) CloseHandle(process.hThread);
    if (process.hProcess != NULL) CloseHandle(process.hProcess);
    mwfn_close_handle(&volume_read);
    mwfn_close_handle(&volume_write);
    mwfn_close_handle(&ack_read);
    mwfn_close_handle(&ack_write);
    for (index = 0; index < 3U; ++index) mwfn_close_handle(&inherited[index]);
    if (attributes != NULL) {
        DeleteProcThreadAttributeList(attributes);
        free(attributes);
    }
    free(command_line);
    for (index = 0; index < count; ++index) free(wide_values[index]);
    return error_code;
}

#endif

#ifdef _WIN32
typedef ULONGLONG mwfn_stream_deadline_t;

static mwfn_stream_deadline_t mwfn_stream_deadline(unsigned int timeout_ms) {
    return GetTickCount64() + timeout_ms;
}

static int mwfn_stream_write(intptr_t volume_write, const uint8_t *bytes, size_t length,
                             mwfn_stream_deadline_t deadline) {
    return mwfn_write_all_win((HANDLE)(uintptr_t)volume_write, bytes, length, deadline);
}

static int mwfn_stream_read_ack(intptr_t ack_read, uint8_t *ack,
                                mwfn_stream_deadline_t deadline) {
    return mwfn_read_exact_win_deadline((HANDLE)(uintptr_t)ack_read, ack, MWFN_ACK_BYTES,
                                        deadline);
}
#else
typedef uint64_t mwfn_stream_deadline_t;

static mwfn_stream_deadline_t mwfn_stream_deadline(unsigned int timeout_ms) {
    return mwfn_now_ms() + timeout_ms;
}

static int mwfn_stream_write(intptr_t volume_write, const uint8_t *bytes, size_t length,
                             mwfn_stream_deadline_t deadline) {
    return mwfn_write_all_posix((int)volume_write, bytes, length, deadline);
}

static int mwfn_stream_read_ack(intptr_t ack_read, uint8_t *ack,
                                mwfn_stream_deadline_t deadline) {
    return mwfn_read_exact_posix_deadline((int)ack_read, ack, MWFN_ACK_BYTES, deadline);
}
#endif

static int mwfn_cube_fallback_enabled(void) {
    const char *value = getenv("MULTIWFN_MATTERVIZ_ALLOW_CUBE_FALLBACK");
    return value != NULL && strcmp(value, "1") == 0;
}

int multiwfn_matterviz_spawn(const char *executable_utf8, const char *frontend_utf8,
                             const char *session_utf8, const char *manifest_utf8,
                             intptr_t *volume_write_out, intptr_t *ack_read_out,
                             int *transport_error_out) {
    int transport_error = 0;
    if (volume_write_out != NULL) *volume_write_out = (intptr_t)-1;
    if (ack_read_out != NULL) *ack_read_out = (intptr_t)-1;
    if (transport_error_out != NULL) *transport_error_out = 0;
    if (volume_write_out == NULL || ack_read_out == NULL || transport_error_out == NULL ||
        executable_utf8 == NULL || frontend_utf8 == NULL || session_utf8 == NULL ||
        manifest_utf8 == NULL) {
        if (transport_error_out != NULL) *transport_error_out = EINVAL;
        return -1;
    }
#ifdef _WIN32
    {
        HANDLE volume_write = NULL;
        HANDLE ack_read = NULL;
        PROCESS_INFORMATION process = {0};
        int error_code = mwfn_spawn_windows(executable_utf8, frontend_utf8, session_utf8,
                                            manifest_utf8, 1, &volume_write, &ack_read,
                                            &process);
        if (error_code == 0) {
            uint8_t ready[MWFN_READY_BYTES];
            transport_error = mwfn_read_exact_win(ack_read, ready, sizeof(ready),
                                                  MWFN_READY_TIMEOUT_MS);
            if (transport_error == 0 && !mwfn_valid_ready(ready)) transport_error = ERROR_INVALID_DATA;
            if (transport_error == 0) {
                CloseHandle(process.hThread);
                CloseHandle(process.hProcess);
                *volume_write_out = (intptr_t)(uintptr_t)volume_write;
                *ack_read_out = (intptr_t)(uintptr_t)ack_read;
                return 0;
            }
            TerminateProcess(process.hProcess, 1);
            (void)WaitForSingleObject(process.hProcess, INFINITE);
            CloseHandle(process.hThread);
            CloseHandle(process.hProcess);
            mwfn_close_handle(&volume_write);
            mwfn_close_handle(&ack_read);
        } else {
            transport_error = error_code;
        }
        if (!mwfn_cube_fallback_enabled()) {
            *transport_error_out = transport_error == 0 ? ERROR_INVALID_DATA : transport_error;
            return -1;
        }
        error_code = mwfn_clear_stop_flag_windows(session_utf8);
        if (error_code == 0) {
            error_code = mwfn_spawn_windows(executable_utf8, frontend_utf8, session_utf8,
                                        manifest_utf8, 0, NULL, NULL, &process);
        }
        if (error_code == 0) {
            CloseHandle(process.hThread);
            CloseHandle(process.hProcess);
            *transport_error_out = transport_error == 0 ? ERROR_INVALID_DATA : transport_error;
            return 0;
        }
        *transport_error_out = error_code;
        return -1;
    }
#else
    {
        pid_t pid = (pid_t)-1;
        pid_t fallback_pid = (pid_t)-1;
        int volume_write = -1;
        int ack_read = -1;
        int error_code = mwfn_spawn_posix(executable_utf8, frontend_utf8, session_utf8,
                                          manifest_utf8, 1, &pid, &volume_write, &ack_read);
        if (error_code == 0) {
            uint8_t ready[MWFN_READY_BYTES];
            error_code = mwfn_read_exact_posix(ack_read, ready, sizeof(ready),
                                               MWFN_READY_TIMEOUT_MS);
            if (error_code == 0 && !mwfn_valid_ready(ready)) error_code = EPROTO;
            if (error_code == 0) {
                error_code = mwfn_register_reaper(pid);
                if (error_code == 0) {
                    *volume_write_out = (intptr_t)volume_write;
                    *ack_read_out = (intptr_t)ack_read;
                    return 0;
                }
            }
            mwfn_close_fd(&volume_write);
            mwfn_close_fd(&ack_read);
            mwfn_reap_terminated(pid);
            transport_error = error_code;
        } else {
            transport_error = error_code;
        }
        if (!mwfn_cube_fallback_enabled()) {
            *transport_error_out = transport_error == 0 ? EPROTO : transport_error;
            return -1;
        }
        error_code = mwfn_clear_stop_flag_posix(session_utf8);
        if (error_code == 0) {
            error_code = mwfn_spawn_file_only_posix(executable_utf8, frontend_utf8, session_utf8,
                                                    manifest_utf8, &fallback_pid);
        }
        if (error_code == 0) error_code = mwfn_register_reaper(fallback_pid);
        if (error_code == 0) {
            *transport_error_out = transport_error == 0 ? EPROTO : transport_error;
            return 0;
        }
        if (fallback_pid >= 0) mwfn_reap_terminated(fallback_pid);
        *transport_error_out = error_code;
        return -1;
    }
#endif
}

int multiwfn_matterviz_select_file(const char *executable_utf8, const char *output_utf8) {
    if (executable_utf8 == NULL || output_utf8 == NULL) return EINVAL;
#ifdef _WIN32
    return mwfn_select_file_windows(executable_utf8, output_utf8);
#else
    return mwfn_select_file_posix(executable_utf8, output_utf8);
#endif
}

int multiwfn_matterviz_publish_volume(
    intptr_t volume_write, intptr_t ack_read, int64_t request_id, int64_t volume_id,
    int32_t nx, int32_t ny, int32_t nz, int32_t data_order, int32_t periodic_axes,
    int32_t coordinate_unit, int32_t quantity_kind, int32_t value_unit,
    const double origin[3], const double voxel_axes[9], const double lattice[9],
    const double *samples, int64_t sample_count, uint32_t publish_timeout_ms) {
    uint8_t *frame = NULL;
    size_t frame_bytes = 0;
    int error_code;
#ifdef _WIN32
    HANDLE volume_handle = (HANDLE)(uintptr_t)volume_write;
    HANDLE ack_handle = (HANDLE)(uintptr_t)ack_read;
    ULONGLONG deadline;
    if (volume_handle == NULL || volume_handle == INVALID_HANDLE_VALUE || ack_handle == NULL ||
        ack_handle == INVALID_HANDLE_VALUE) return MWFN_ERR_HANDLE;
#else
    uint64_t deadline;
    if (volume_write < 0 || ack_read < 0) return MWFN_ERR_HANDLE;
#endif
    if (publish_timeout_ms == 0U) return MWFN_ERR_TIMEOUT;
    error_code = mwfn_build_volume(&frame, &frame_bytes, request_id, volume_id, nx, ny, nz,
                                   data_order, periodic_axes, coordinate_unit, quantity_kind,
                                   value_unit, origin, voxel_axes, lattice, samples, sample_count);
    if (error_code != 0) return error_code == ENOMEM ? ENOMEM : MWFN_ERR_INVALID;
#ifdef _WIN32
    deadline = GetTickCount64() + publish_timeout_ms;
    error_code = mwfn_write_all_win(volume_handle, frame, frame_bytes, deadline);
    free(frame);
    if (error_code == ETIMEDOUT) return MWFN_ERR_TIMEOUT;
    if (error_code != 0) return error_code;
    {
        uint8_t ack[MWFN_ACK_BYTES];
        error_code = mwfn_read_exact_win_deadline(ack_handle, ack, sizeof(ack), deadline);
        if (error_code == ETIMEDOUT) return MWFN_ERR_TIMEOUT;
        if (error_code != 0) return error_code;
        if (!mwfn_valid_ack(ack, request_id, volume_id)) {
            return mwfn_valid_ack_fields(ack, request_id, volume_id, 0) ? MWFN_ERR_REJECTED
                                                                        : MWFN_ERR_PROTOCOL;
        }
    }
#else
    deadline = mwfn_now_ms() + publish_timeout_ms;
    error_code = mwfn_write_all_posix((int)volume_write, frame, frame_bytes, deadline);
    free(frame);
    if (error_code == ETIMEDOUT) return MWFN_ERR_TIMEOUT;
    if (error_code != 0) return error_code;
    {
        uint8_t ack[MWFN_ACK_BYTES];
        error_code = mwfn_read_exact_posix_deadline((int)ack_read, ack, sizeof(ack), deadline);
        if (error_code == ETIMEDOUT) return MWFN_ERR_TIMEOUT;
        if (error_code != 0) return error_code;
        if (!mwfn_valid_ack(ack, request_id, volume_id)) {
            return mwfn_valid_ack_fields(ack, request_id, volume_id, 0) ? MWFN_ERR_REJECTED
                                                                          : MWFN_ERR_PROTOCOL;
        }
    }
#endif
    return 0;
}

/*
 * Publish a major-2 volume without allocating storage proportional to the
 * sample body. Major 2 keeps the v1 header/body layout but removes the v1
 * sample/body size limit. The caller owns samples for the duration of this
 * call; transport negotiation remains outside this primitive.
 */
int multiwfn_matterviz_publish_volume_stream(
    intptr_t volume_write, intptr_t ack_read, int64_t request_id, int64_t volume_id,
    int32_t nx, int32_t ny, int32_t nz, int32_t data_order, int32_t periodic_axes,
    int32_t coordinate_unit, int32_t quantity_kind, int32_t value_unit,
    const double origin[3], const double voxel_axes[9], const double lattice[9],
    const double *samples, int64_t sample_count, uint32_t publish_timeout_ms) {
    uint8_t header[MWFN_HEADER_BYTES] = {0};
    uint64_t count;
    uint64_t body_bytes;
    uint32_t body_crc = UINT32_MAX;
    double minimum = 0.0;
    double maximum = 0.0;
    double mean_sum = 0.0;
    double abs_max = 0.0;
    mwfn_stream_deadline_t deadline;
    uint64_t offset;
    unsigned int index;
    int error_code;

#ifdef _WIN32
    if ((HANDLE)(uintptr_t)volume_write == NULL ||
        (HANDLE)(uintptr_t)volume_write == INVALID_HANDLE_VALUE ||
        (HANDLE)(uintptr_t)ack_read == NULL ||
        (HANDLE)(uintptr_t)ack_read == INVALID_HANDLE_VALUE) {
        return MWFN_ERR_HANDLE;
    }
#else
    if (volume_write < 0 || ack_read < 0) return MWFN_ERR_HANDLE;
#endif
    if (publish_timeout_ms == 0U) return MWFN_ERR_TIMEOUT;
    if (!mwfn_host_is_little_endian()) return MWFN_ERR_UNSUPPORTED;
    if (request_id <= 0 || volume_id <= 0 || data_order < 1 || data_order > 2 ||
        (periodic_axes & ~7) != 0 || (coordinate_unit != 1 && coordinate_unit != 2) ||
        (quantity_kind < 1 || quantity_kind > 3) ||
        ((quantity_kind == 1 && value_unit != 1) ||
         (quantity_kind == 2 && value_unit != 2) ||
         (quantity_kind == 3 && value_unit != 3)) || origin == NULL ||
        voxel_axes == NULL || lattice == NULL || samples == NULL) {
        return MWFN_ERR_INVALID;
    }
    error_code = mwfn_stream_shape(nx, ny, nz, sample_count, &count, &body_bytes);
    if (error_code != 0) return error_code == EOVERFLOW ? EOVERFLOW : MWFN_ERR_INVALID;
    for (index = 0; index < 3U; ++index) {
        if (!isfinite(origin[index])) return MWFN_ERR_INVALID;
    }
    for (index = 0; index < 9U; ++index) {
        if (!isfinite(voxel_axes[index]) || !isfinite(lattice[index])) {
            return MWFN_ERR_INVALID;
        }
    }

    for (offset = 0; offset < count; ++offset) {
        const double value = samples[(size_t)offset];
        const double absolute = fabs(value);
        if (!isfinite(value) || !isfinite(absolute)) return MWFN_ERR_INVALID;
        if (offset == 0U) {
            minimum = value;
            maximum = value;
        } else {
            if (value < minimum) minimum = value;
            if (value > maximum) maximum = value;
        }
        mean_sum += value;
        if (!isfinite(mean_sum)) return MWFN_ERR_INVALID;
        if (absolute > abs_max) abs_max = absolute;
        body_crc = mwfn_crc32c_update(body_crc, (const uint8_t *)&value, sizeof(value));
    }
    body_crc = ~body_crc;
    {
        const double mean = mean_sum / (double)count;
        if (!isfinite(minimum) || !isfinite(maximum) || !isfinite(mean) || !isfinite(abs_max)) {
            return MWFN_ERR_INVALID;
        }
        memcpy(header, "MWFNVOL\0", 8U);
        mwfn_put_u16(header + 8, 2U);
        mwfn_put_u16(header + 10, 0U);
        mwfn_put_u16(header + 12, 4U);
        mwfn_put_u16(header + 14, 3U);
        mwfn_put_u32(header + 16, MWFN_HEADER_BYTES);
        mwfn_put_u64(header + 20, (uint64_t)request_id);
        mwfn_put_u64(header + 28, body_bytes);
        mwfn_put_u64(header + 48, (uint64_t)volume_id);
        mwfn_put_u32(header + 56, (uint32_t)nx);
        mwfn_put_u32(header + 60, (uint32_t)ny);
        mwfn_put_u32(header + 64, (uint32_t)nz);
        header[68] = 1U;
        header[69] = 1U;
        header[70] = (uint8_t)data_order;
        header[71] = (uint8_t)periodic_axes;
        mwfn_put_u16(header + 72, (uint16_t)coordinate_unit);
        mwfn_put_u16(header + 74, (uint16_t)quantity_kind);
        mwfn_put_u16(header + 76, (uint16_t)value_unit);
        for (index = 0; index < 3U; ++index) {
            mwfn_put_f64(header + 80U + index * 8U, origin[index]);
        }
        for (index = 0; index < 9U; ++index) {
            mwfn_put_f64(header + 104U + index * 8U, voxel_axes[index]);
            mwfn_put_f64(header + 176U + index * 8U, lattice[index]);
        }
        mwfn_put_u64(header + 248, count);
        mwfn_put_u64(header + 256, body_bytes);
        mwfn_put_f64(header + 264, minimum);
        mwfn_put_f64(header + 272, maximum);
        mwfn_put_f64(header + 280, mean);
        mwfn_put_f64(header + 288, abs_max);
        mwfn_put_u32(header + 40, body_crc);
        mwfn_put_u32(header + 36, mwfn_crc32c(header, sizeof(header)));
    }

    deadline = mwfn_stream_deadline(publish_timeout_ms);
    error_code = mwfn_stream_write(volume_write, header, sizeof(header), deadline);
    if (error_code == ETIMEDOUT) return MWFN_ERR_TIMEOUT;
    if (error_code != 0) return error_code;
    for (offset = 0; offset < count;) {
        const uint64_t remaining = count - offset;
        const size_t chunk_samples = remaining > MWFN_STREAM_CHUNK_BYTES / sizeof(double)
                                         ? MWFN_STREAM_CHUNK_BYTES / sizeof(double)
                                         : (size_t)remaining;
        const size_t chunk_bytes = chunk_samples * sizeof(double);
        error_code = mwfn_stream_write(
            volume_write, (const uint8_t *)(samples + (size_t)offset), chunk_bytes, deadline);
        if (error_code == ETIMEDOUT) return MWFN_ERR_TIMEOUT;
        if (error_code != 0) return error_code;
        offset += (uint64_t)chunk_samples;
    }
    {
        uint8_t ack[MWFN_ACK_BYTES];
        error_code = mwfn_stream_read_ack(ack_read, ack, deadline);
        if (error_code == ETIMEDOUT) return MWFN_ERR_TIMEOUT;
        if (error_code != 0) return error_code;
        if (!mwfn_valid_stream_ack(ack, request_id, volume_id)) {
            return mwfn_valid_ack_fields_major(ack, 2U, request_id, volume_id, 0)
                       ? MWFN_ERR_REJECTED
                       : MWFN_ERR_PROTOCOL;
        }
    }
    return 0;
}

void multiwfn_matterviz_transport_close(intptr_t *volume_write_io, intptr_t *ack_read_io) {
    if (volume_write_io != NULL) {
#ifdef _WIN32
        HANDLE handle = (HANDLE)(uintptr_t)*volume_write_io;
        if (handle != NULL && handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
#else
        if (*volume_write_io >= 0) (void)close((int)*volume_write_io);
#endif
        *volume_write_io = (intptr_t)-1;
    }
    if (ack_read_io != NULL) {
#ifdef _WIN32
        HANDLE handle = (HANDLE)(uintptr_t)*ack_read_io;
        if (handle != NULL && handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
#else
        if (*ack_read_io >= 0) (void)close((int)*ack_read_io);
#endif
        *ack_read_io = (intptr_t)-1;
    }
}

/* Legacy ABI retained for existing Fortran launch paths. */
int multiwfn_spawn_async(const char *command) {
#ifdef _WIN32
    STARTUPINFOEXW startup = {0};
    PROCESS_INFORMATION process = {0};
    HANDLE inherited_handles[3] = {NULL, NULL, NULL};
    SIZE_T attribute_size = 0;
    LPPROC_THREAD_ATTRIBUTE_LIST attributes = NULL;
    wchar_t *wide;
    DWORD error_code;
    int length;
    if (command == NULL) return (int)ERROR_INVALID_PARAMETER;
    length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, command, -1, NULL, 0);
    if (length <= 0) return (int)(GetLastError() == 0 ? ERROR_NO_UNICODE_TRANSLATION : GetLastError());
    wide = (wchar_t *)malloc((size_t)length * sizeof(wchar_t));
    if (wide == NULL) return (int)ERROR_NOT_ENOUGH_MEMORY;
    if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, command, -1, wide, length) <= 0) {
        free(wide);
        return (int)ERROR_NO_UNICODE_TRANSLATION;
    }
    inherited_handles[0] = mwfn_inheritable_std_handle(STD_INPUT_HANDLE, GENERIC_READ);
    inherited_handles[1] = mwfn_inheritable_std_handle(STD_OUTPUT_HANDLE, GENERIC_WRITE);
    inherited_handles[2] = mwfn_inheritable_std_handle(STD_ERROR_HANDLE, GENERIC_WRITE);
    if (inherited_handles[0] == NULL || inherited_handles[0] == INVALID_HANDLE_VALUE ||
        inherited_handles[1] == NULL || inherited_handles[1] == INVALID_HANDLE_VALUE ||
        inherited_handles[2] == NULL || inherited_handles[2] == INVALID_HANDLE_VALUE) {
        error_code = GetLastError();
        mwfn_close_handle(&inherited_handles[0]);
        mwfn_close_handle(&inherited_handles[1]);
        mwfn_close_handle(&inherited_handles[2]);
        free(wide);
        return (int)(error_code == 0 ? ERROR_INVALID_HANDLE : error_code);
    }
    InitializeProcThreadAttributeList(NULL, 1, 0, &attribute_size);
    attributes = (LPPROC_THREAD_ATTRIBUTE_LIST)malloc(attribute_size);
    if (attributes == NULL) {
        mwfn_close_handle(&inherited_handles[0]);
        mwfn_close_handle(&inherited_handles[1]);
        mwfn_close_handle(&inherited_handles[2]);
        free(wide);
        return (int)ERROR_NOT_ENOUGH_MEMORY;
    }
    if (!InitializeProcThreadAttributeList(attributes, 1, 0, &attribute_size) ||
        !UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                                   inherited_handles, sizeof(inherited_handles), NULL, NULL)) {
        error_code = GetLastError();
        DeleteProcThreadAttributeList(attributes);
        free(attributes);
        mwfn_close_handle(&inherited_handles[0]);
        mwfn_close_handle(&inherited_handles[1]);
        mwfn_close_handle(&inherited_handles[2]);
        free(wide);
        return (int)(error_code == 0 ? ERROR_INVALID_PARAMETER : error_code);
    }
    startup.StartupInfo.cb = sizeof(startup);
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = inherited_handles[0];
    startup.StartupInfo.hStdOutput = inherited_handles[1];
    startup.StartupInfo.hStdError = inherited_handles[2];
    startup.lpAttributeList = attributes;
    if (!CreateProcessW(NULL, wide, NULL, NULL, TRUE, EXTENDED_STARTUPINFO_PRESENT, NULL, NULL,
                        &startup.StartupInfo, &process)) {
        error_code = GetLastError();
        DeleteProcThreadAttributeList(attributes);
        free(attributes);
        mwfn_close_handle(&inherited_handles[0]);
        mwfn_close_handle(&inherited_handles[1]);
        mwfn_close_handle(&inherited_handles[2]);
        free(wide);
        return (int)(error_code == 0 ? ERROR_INVALID_PARAMETER : error_code);
    }
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    DeleteProcThreadAttributeList(attributes);
    free(attributes);
    mwfn_close_handle(&inherited_handles[0]);
    mwfn_close_handle(&inherited_handles[1]);
    mwfn_close_handle(&inherited_handles[2]);
    free(wide);
    return 0;
#else
    (void)command;
    return -1;
#endif
}
