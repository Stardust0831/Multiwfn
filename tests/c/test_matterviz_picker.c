#define _POSIX_C_SOURCE 200809L

#include <assert.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

int multiwfn_matterviz_select_file(const char *executable_utf8, char *result_utf8,
                                   int64_t result_capacity, int64_t *result_bytes_out,
                                   int32_t *picker_status_out);

#define ERR_PROTOCOL (-1002)
#define ERR_BUFFER (-1007)
#define PICK_HEADER_BYTES 32U
#define PICK_MAX_BODY_BYTES 32768U

static void put_u16(uint8_t *dst, uint16_t value) {
    dst[0] = (uint8_t)value;
    dst[1] = (uint8_t)(value >> 8);
}

static void put_u32(uint8_t *dst, uint32_t value) {
    dst[0] = (uint8_t)value;
    dst[1] = (uint8_t)(value >> 8);
    dst[2] = (uint8_t)(value >> 16);
    dst[3] = (uint8_t)(value >> 24);
}

static uint32_t crc32c_update(uint32_t crc, const uint8_t *data, size_t length) {
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

static uint32_t crc32c(const uint8_t *data, size_t length) {
    return ~crc32c_update(UINT32_MAX, data, length);
}

static int write_all(int fd, const uint8_t *data, size_t length) {
    size_t offset = 0;
    while (offset < length) {
        ssize_t written = write(fd, data + offset, length - offset);
        if (written < 0 && errno == EINTR) continue;
        if (written <= 0) return -1;
        offset += (size_t)written;
    }
    return 0;
}

static size_t build_frame(uint8_t *frame, uint16_t status, const uint8_t *body,
                          uint32_t body_bytes, int bad_crc) {
    uint8_t header[PICK_HEADER_BYTES];
    memset(frame, 0, PICK_HEADER_BYTES + body_bytes);
    memcpy(frame, "MWFNPICK", 8U);
    put_u16(frame + 8, 1U);
    put_u16(frame + 10, 0U);
    put_u16(frame + 12, status);
    put_u16(frame + 14, UINT16_C(0x0001) | (body_bytes == 0U ? 0U : UINT16_C(0x0002)));
    put_u32(frame + 16, PICK_HEADER_BYTES);
    put_u32(frame + 20, body_bytes);
    if (body_bytes > 0U) {
        memcpy(frame + PICK_HEADER_BYTES, body, body_bytes);
        put_u32(frame + 24, crc32c(body, body_bytes));
    }
    memcpy(header, frame, sizeof(header));
    memset(header + 28, 0, 4U);
    put_u32(frame + 28, crc32c(header, sizeof(header)) ^ (bad_crc ? 1U : 0U));
    return PICK_HEADER_BYTES + body_bytes;
}

static int child_main(int argc, char **argv) {
    const char *mode = getenv("MWFN_PICKER_TEST_MODE");
    int fd = -1;
    uint8_t frame[PICK_HEADER_BYTES + PICK_MAX_BODY_BYTES + 1U];
    uint8_t large_body[PICK_MAX_BODY_BYTES + 1U];
    static const uint8_t selected[] = "/tmp/matterviz-selected.dat";
    static const uint8_t error_body[] = "picker failed";
    size_t frame_bytes;
    int index;
    for (index = 1; index + 1 < argc; ++index) {
        if (strcmp(argv[index], "--result-pipe") == 0) {
            fd = atoi(argv[index + 1]);
            break;
        }
    }
    if (fd < 0 || mode == NULL) return 2;
    if (strcmp(mode, "selected") == 0 || strcmp(mode, "fragmented") == 0 ||
        strcmp(mode, "capacity") == 0) {
        frame_bytes = build_frame(frame, 1U, selected, (uint32_t)(sizeof(selected) - 1U), 0);
    } else if (strcmp(mode, "cancel") == 0) {
        frame_bytes = build_frame(frame, 0U, NULL, 0U, 0);
    } else if (strcmp(mode, "error") == 0) {
        frame_bytes = build_frame(frame, 2U, error_body, (uint32_t)(sizeof(error_body) - 1U), 0);
    } else if (strcmp(mode, "bad-crc") == 0) {
        frame_bytes = build_frame(frame, 1U, selected, (uint32_t)(sizeof(selected) - 1U), 1);
    } else if (strcmp(mode, "invalid-utf8") == 0) {
        const uint8_t invalid = 0xffU;
        frame_bytes = build_frame(frame, 1U, &invalid, 1U, 0);
    } else if (strcmp(mode, "nul") == 0) {
        static const uint8_t nul_body[] = {'a', 0, 'b'};
        frame_bytes = build_frame(frame, 1U, nul_body, (uint32_t)sizeof(nul_body), 0);
    } else if (strcmp(mode, "bounds") == 0) {
        memset(large_body, 'x', sizeof(large_body));
        frame_bytes = build_frame(frame, 1U, large_body, (uint32_t)sizeof(large_body), 0);
    } else if (strcmp(mode, "trailing") == 0) {
        frame_bytes = build_frame(frame, 1U, selected, (uint32_t)(sizeof(selected) - 1U), 0);
    } else {
        return 2;
    }
    if (strcmp(mode, "fragmented") == 0) {
        size_t offset;
        for (offset = 0; offset < frame_bytes; ++offset) {
            if (write_all(fd, frame + offset, 1U) != 0) return 3;
            {
                const struct timespec delay = {0, 1000000L};
                (void)nanosleep(&delay, NULL);
            }
        }
    } else if (write_all(fd, frame, frame_bytes) != 0) {
        return 3;
    }
    if (strcmp(mode, "trailing") == 0) {
        uint8_t trailing[1024];
        memset(trailing, 't', sizeof(trailing));
        for (index = 0; index < 1024; ++index) {
            if (write_all(fd, trailing, sizeof(trailing)) != 0) return 4;
        }
    }
    close(fd);
    return strcmp(mode, "error") == 0 ? 2 : 0;
}

static int run_picker(const char *executable, const char *mode, char *result,
                      int64_t capacity, int64_t *bytes, int32_t *status) {
    assert(setenv("MWFN_PICKER_TEST_MODE", mode, 1) == 0);
    int rc = multiwfn_matterviz_select_file(executable, result, capacity, bytes, status);
    assert(unsetenv("MWFN_PICKER_TEST_MODE") == 0);
    return rc;
}

static void test_valid_statuses(const char *executable) {
    char result[128];
    int64_t bytes;
    int32_t status;
    assert(run_picker(executable, "selected", result, sizeof(result), &bytes, &status) == 0);
    assert(status == 1 && bytes == (int64_t)strlen("/tmp/matterviz-selected.dat"));
    assert(strcmp(result, "/tmp/matterviz-selected.dat") == 0);
    assert(run_picker(executable, "cancel", result, sizeof(result), &bytes, &status) == 0);
    assert(status == 0 && bytes == 0 && result[0] == '\0');
    assert(run_picker(executable, "error", result, sizeof(result), &bytes, &status) == 0);
    assert(status == 2 && strcmp(result, "picker failed") == 0);
}

static void test_strict_failures(const char *executable) {
    char result[128];
    int64_t bytes;
    int32_t status;
    assert(run_picker(executable, "fragmented", result, sizeof(result), &bytes, &status) == 0);
    assert(status == 1 && strcmp(result, "/tmp/matterviz-selected.dat") == 0);
    assert(run_picker(executable, "bad-crc", result, sizeof(result), &bytes, &status) == ERR_PROTOCOL);
    assert(run_picker(executable, "invalid-utf8", result, sizeof(result), &bytes, &status) ==
           ERR_PROTOCOL);
    assert(run_picker(executable, "nul", result, sizeof(result), &bytes, &status) == ERR_PROTOCOL);
    assert(run_picker(executable, "bounds", result, sizeof(result), &bytes, &status) == ERR_PROTOCOL);
    assert(run_picker(executable, "trailing", result, sizeof(result), &bytes, &status) == ERR_PROTOCOL);
    assert(run_picker(executable, "capacity", result, 4, &bytes, &status) == ERR_BUFFER);
    assert(status == 1 && bytes == (int64_t)strlen("/tmp/matterviz-selected.dat"));
}

int main(int argc, char **argv) {
    if (argc > 1 && strcmp(argv[1], "--select-file") == 0) return child_main(argc, argv);
    assert(argc > 0);
    test_valid_statuses(argv[0]);
    test_strict_failures(argv[0]);
    return 0;
}
