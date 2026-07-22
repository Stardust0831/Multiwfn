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
#define MWFN_CONTROL_HEADER_BYTES 48U
#define MWFN_CONTROL_MAX_BODY_BYTES UINT64_C(67108864)
#define MWFN_CONTROL_FLAG_HEADER_CRC UINT16_C(0x0001)
#define MWFN_CONTROL_FLAG_BODY_CRC UINT16_C(0x0002)
#define MWFN_ERR_BUFFER (-1007)
#define MWFN_PICK_HEADER_BYTES 32U
#define MWFN_PICK_MAX_BODY_BYTES UINT32_C(32768)
#define MWFN_PICK_READ_TIMEOUT_MS 15000U
#define MWFN_CONTROL_FRAME_TIMEOUT_MS 30000U
#define MWFN_PICK_STATUS_CANCEL UINT16_C(0)
#define MWFN_PICK_STATUS_SELECTED UINT16_C(1)
#define MWFN_PICK_STATUS_ERROR UINT16_C(2)
#define MWFN_PICK_FLAG_HEADER_CRC UINT16_C(0x0001)
#define MWFN_PICK_FLAG_BODY_CRC UINT16_C(0x0002)

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

static int mwfn_picker_utf8_valid(const uint8_t *bytes, size_t length) {
    size_t index = 0;
    while (index < length) {
        const uint8_t first = bytes[index++];
        if (first <= 0x7fU) continue;
        if (first >= 0xc2U && first <= 0xdfU) {
            if (index >= length || bytes[index] < 0x80U || bytes[index] > 0xbfU) return 0;
            ++index;
            continue;
        }
        if (first == 0xe0U) {
            if (index + 1U >= length || bytes[index] < 0xa0U || bytes[index] > 0xbfU ||
                bytes[index + 1U] < 0x80U || bytes[index + 1U] > 0xbfU) {
                return 0;
            }
            index += 2U;
            continue;
        }
        if ((first >= 0xe1U && first <= 0xecU) || (first >= 0xeeU && first <= 0xefU)) {
            if (index + 1U >= length || bytes[index] < 0x80U || bytes[index] > 0xbfU ||
                bytes[index + 1U] < 0x80U || bytes[index + 1U] > 0xbfU) {
                return 0;
            }
            index += 2U;
            continue;
        }
        if (first == 0xedU) {
            if (index + 1U >= length || bytes[index] < 0x80U || bytes[index] > 0x9fU ||
                bytes[index + 1U] < 0x80U || bytes[index + 1U] > 0xbfU) {
                return 0;
            }
            index += 2U;
            continue;
        }
        if (first == 0xf0U) {
            if (index + 2U >= length || bytes[index] < 0x90U || bytes[index] > 0xbfU ||
                bytes[index + 1U] < 0x80U || bytes[index + 1U] > 0xbfU ||
                bytes[index + 2U] < 0x80U || bytes[index + 2U] > 0xbfU) {
                return 0;
            }
            index += 3U;
            continue;
        }
        if (first >= 0xf1U && first <= 0xf3U) {
            if (index + 2U >= length || bytes[index] < 0x80U || bytes[index] > 0xbfU ||
                bytes[index + 1U] < 0x80U || bytes[index + 1U] > 0xbfU ||
                bytes[index + 2U] < 0x80U || bytes[index + 2U] > 0xbfU) {
                return 0;
            }
            index += 3U;
            continue;
        }
        if (first == 0xf4U) {
            if (index + 2U >= length || bytes[index] < 0x80U || bytes[index] > 0x8fU ||
                bytes[index + 1U] < 0x80U || bytes[index + 1U] > 0xbfU ||
                bytes[index + 2U] < 0x80U || bytes[index + 2U] > 0xbfU) {
                return 0;
            }
            index += 3U;
            continue;
        }
        return 0;
    }
    return 1;
}

static int mwfn_picker_header_valid(const uint8_t header[MWFN_PICK_HEADER_BYTES],
                                    uint16_t *status_out, uint32_t *body_bytes_out) {
    uint8_t copy[MWFN_PICK_HEADER_BYTES];
    uint16_t status;
    uint16_t flags;
    uint32_t body_bytes;
    uint16_t expected_flags;
    if (memcmp(header, "MWFNPICK", 8U) != 0 || mwfn_get_u16(header + 8) != 1U ||
        mwfn_get_u16(header + 10) != 0U || mwfn_get_u32(header + 16) != MWFN_PICK_HEADER_BYTES) {
        return 0;
    }
    status = mwfn_get_u16(header + 12);
    if (status > MWFN_PICK_STATUS_ERROR) return 0;
    flags = mwfn_get_u16(header + 14);
    body_bytes = mwfn_get_u32(header + 20);
    if (body_bytes > MWFN_PICK_MAX_BODY_BYTES) return 0;
    expected_flags = MWFN_PICK_FLAG_HEADER_CRC |
                     (body_bytes == 0U ? 0U : MWFN_PICK_FLAG_BODY_CRC);
    if (flags != expected_flags || (body_bytes == 0U && mwfn_get_u32(header + 24) != 0U)) {
        return 0;
    }
    memcpy(copy, header, sizeof(copy));
    memset(copy + 28, 0, 4U);
    if (mwfn_crc32c(copy, sizeof(copy)) != mwfn_get_u32(header + 28)) return 0;
    if ((status == MWFN_PICK_STATUS_CANCEL && body_bytes != 0U) ||
        (status != MWFN_PICK_STATUS_CANCEL && body_bytes == 0U)) {
        return 0;
    }
    if (status_out != NULL) *status_out = status;
    if (body_bytes_out != NULL) *body_bytes_out = body_bytes;
    return 1;
}

static int mwfn_picker_body_valid(uint16_t status, const uint8_t *body, uint32_t body_bytes,
                                  uint32_t expected_crc) {
    uint32_t actual_crc;
    if (body_bytes > MWFN_PICK_MAX_BODY_BYTES ||
        (body_bytes > 0U && body == NULL) || memchr(body, 0, body_bytes) != NULL) {
        return 0;
    }
    if (status == MWFN_PICK_STATUS_CANCEL) return body_bytes == 0U;
    if (body_bytes == 0U || !mwfn_picker_utf8_valid(body, body_bytes)) return 0;
    actual_crc = mwfn_crc32c(body, body_bytes);
    return actual_crc == expected_crc;
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

static int mwfn_control_fields_valid(uint16_t message_type, uint16_t flags,
                                     uint64_t request_id, uint64_t body_bytes) {
    if (message_type < 1U || message_type > 6U || body_bytes > MWFN_CONTROL_MAX_BODY_BYTES) {
        return 0;
    }
    if (message_type == 1U) {
        return flags == MWFN_CONTROL_FLAG_HEADER_CRC && request_id == 0U && body_bytes == 0U;
    }
    if (flags != (MWFN_CONTROL_FLAG_HEADER_CRC | MWFN_CONTROL_FLAG_BODY_CRC) ||
        body_bytes == 0U) {
        return 0;
    }
    if (message_type == 3U || message_type == 4U || message_type == 5U) {
        return request_id != 0U;
    }
    return request_id == 0U;
}

static int mwfn_control_header_valid(const uint8_t header[MWFN_CONTROL_HEADER_BYTES]) {
    uint8_t copy[MWFN_CONTROL_HEADER_BYTES];
    if (memcmp(header, "MWFNCTL\0", 8U) != 0 || mwfn_get_u16(header + 8) != 1U ||
        mwfn_get_u16(header + 10) != 0U ||
        mwfn_get_u32(header + 16) != MWFN_CONTROL_HEADER_BYTES ||
        mwfn_get_u32(header + 44) != 0U ||
        !mwfn_control_fields_valid(mwfn_get_u16(header + 12), mwfn_get_u16(header + 14),
                                   mwfn_get_u64(header + 20), mwfn_get_u64(header + 28))) {
        return 0;
    }
    memcpy(copy, header, sizeof(copy));
    memset(copy + 36, 0, 4U);
    return mwfn_crc32c(copy, sizeof(copy)) == mwfn_get_u32(header + 36);
}

typedef struct {
    uint8_t *bytes;
    size_t length;
    size_t capacity;
} mwfn_control_buffer_t;

static void mwfn_control_wipe(void *bytes, size_t length) {
    volatile uint8_t *cursor = (volatile uint8_t *)bytes;
    while (length-- > 0) *cursor++ = 0;
}

int multiwfn_matterviz_control_send(intptr_t response_write, int32_t message_type,
                                    int64_t request_id, const char *body,
                                    int64_t body_bytes, uint32_t timeout_ms);

static mwfn_control_buffer_t *mwfn_control_buffer_from_handle(intptr_t handle) {
    if (handle <= 0) return NULL;
    return (mwfn_control_buffer_t *)(uintptr_t)handle;
}

intptr_t multiwfn_matterviz_control_buffer_create(void) {
    mwfn_control_buffer_t *buffer = (mwfn_control_buffer_t *)calloc(1, sizeof(*buffer));
    return buffer == NULL ? (intptr_t)-1 : (intptr_t)(uintptr_t)buffer;
}

int multiwfn_matterviz_control_buffer_append(intptr_t handle, const void *bytes,
                                              int64_t length) {
    mwfn_control_buffer_t *buffer = mwfn_control_buffer_from_handle(handle);
    size_t append_length;
    size_t needed;
    size_t capacity;
    uint8_t *grown;
    if (buffer == NULL || length < 0 || (length > 0 && bytes == NULL)) return MWFN_ERR_INVALID;
    append_length = (size_t)length;
    if (append_length > (size_t)MWFN_CONTROL_MAX_BODY_BYTES - buffer->length) {
        return MWFN_ERR_BUFFER;
    }
    needed = buffer->length + append_length;
    if (needed > buffer->capacity) {
        capacity = buffer->capacity == 0 ? 256U : buffer->capacity;
        while (capacity < needed) {
            if (capacity > (size_t)MWFN_CONTROL_MAX_BODY_BYTES / 2U) {
                capacity = (size_t)MWFN_CONTROL_MAX_BODY_BYTES;
                break;
            }
            capacity *= 2U;
        }
        grown = (uint8_t *)realloc(buffer->bytes, capacity);
        if (grown == NULL) return MWFN_ERR_BUFFER;
        buffer->bytes = grown;
        buffer->capacity = capacity;
    }
    if (append_length > 0) memcpy(buffer->bytes + buffer->length, bytes, append_length);
    buffer->length = needed;
    return 0;
}

int multiwfn_matterviz_control_buffer_clear(intptr_t handle) {
    mwfn_control_buffer_t *buffer = mwfn_control_buffer_from_handle(handle);
    if (buffer == NULL) return MWFN_ERR_INVALID;
    if (buffer->bytes != NULL && buffer->length > 0) mwfn_control_wipe(buffer->bytes, buffer->length);
    buffer->length = 0;
    return 0;
}

int multiwfn_matterviz_control_buffer_send(intptr_t handle, intptr_t response_write,
                                            int32_t message_type, int64_t request_id,
                                            uint32_t timeout_ms) {
    mwfn_control_buffer_t *buffer = mwfn_control_buffer_from_handle(handle);
    if (buffer == NULL || buffer->length > INT64_MAX) return MWFN_ERR_INVALID;
    return multiwfn_matterviz_control_send(response_write, message_type, request_id,
                                           (const char *)buffer->bytes,
                                           (int64_t)buffer->length, timeout_ms);
}

void multiwfn_matterviz_control_buffer_destroy(intptr_t *handle_io) {
    mwfn_control_buffer_t *buffer;
    if (handle_io == NULL || *handle_io <= 0) {
        if (handle_io != NULL) *handle_io = (intptr_t)-1;
        return;
    }
    buffer = mwfn_control_buffer_from_handle(*handle_io);
    if (buffer != NULL) {
        if (buffer->bytes != NULL) {
            if (buffer->capacity > 0) mwfn_control_wipe(buffer->bytes, buffer->capacity);
            free(buffer->bytes);
        }
        mwfn_control_wipe(buffer, sizeof(*buffer));
        free(buffer);
    }
    *handle_io = (intptr_t)-1;
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
        (quantity_kind < 1 || quantity_kind > 4) ||
        ((quantity_kind == 1 && value_unit != 1) ||
         (quantity_kind == 2 && value_unit != 2) ||
         (quantity_kind == 3 && value_unit != 3) ||
         (quantity_kind == 4 && value_unit != 4)) || origin == NULL || voxel_axes == NULL ||
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

static int mwfn_drain_posix_deadline(int fd, uint64_t deadline, int *had_data_out) {
    uint8_t buffer[4096];
    int had_data = 0;
    for (;;) {
        struct pollfd descriptor;
        int poll_result;
        ssize_t result;
        const uint64_t now = mwfn_now_ms();
        int wait_ms;
        if (now >= deadline) return ETIMEDOUT;
        wait_ms = (int)(deadline - now > INT_MAX ? INT_MAX : deadline - now);
        descriptor.fd = fd;
        descriptor.events = POLLIN;
        descriptor.revents = 0;
        poll_result = poll(&descriptor, 1, wait_ms);
        if (poll_result < 0 && errno == EINTR) continue;
        if (poll_result < 0) return errno;
        if (poll_result == 0) return ETIMEDOUT;
        do {
            result = read(fd, buffer, sizeof(buffer));
        } while (result < 0 && errno == EINTR);
        if (result < 0) return errno;
        if (result == 0) {
            if (had_data_out != NULL) *had_data_out = had_data;
            return 0;
        }
        had_data = 1;
    }
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
                            int *volume_write_out, int *ack_read_out,
                            int *request_read_out, int *response_write_out) {
    int volume_pipe[2] = {-1, -1};
    int ack_pipe[2] = {-1, -1};
    int request_pipe[2] = {-1, -1};
    int response_pipe[2] = {-1, -1};
    int exec_pipe[2] = {-1, -1};
    pid_t pid;
    char volume_fd[32];
    char ack_fd[32];
    char request_fd[32];
    char response_fd[32];
    char multiwfn_pid[32];
    char *argv[20];
    unsigned int argc = 0;
    int error_code;
    if (mwfn_pipe_cloexec(exec_pipe) != 0 ||
        (with_transport && (mwfn_pipe_cloexec(volume_pipe) != 0 ||
                            mwfn_pipe_cloexec(ack_pipe) != 0 ||
                            mwfn_pipe_cloexec(request_pipe) != 0 ||
                            mwfn_pipe_cloexec(response_pipe) != 0))) {
        error_code = errno == 0 ? EIO : errno;
        mwfn_close_fd(&exec_pipe[0]);
        mwfn_close_fd(&exec_pipe[1]);
        mwfn_close_fd(&volume_pipe[0]);
        mwfn_close_fd(&volume_pipe[1]);
        mwfn_close_fd(&ack_pipe[0]);
        mwfn_close_fd(&ack_pipe[1]);
        mwfn_close_fd(&request_pipe[0]);
        mwfn_close_fd(&request_pipe[1]);
        mwfn_close_fd(&response_pipe[0]);
        mwfn_close_fd(&response_pipe[1]);
        return error_code;
    }
    argv[argc++] = (char *)executable;
    argv[argc++] = (char *)"--frontend";
    argv[argc++] = (char *)frontend;
    argv[argc++] = (char *)"--session";
    argv[argc++] = (char *)session;
    argv[argc++] = (char *)"--manifest";
    argv[argc++] = (char *)manifest;
    (void)snprintf(multiwfn_pid, sizeof(multiwfn_pid), "%ld", (long)getpid());
    argv[argc++] = (char *)"--multiwfn-pid";
    argv[argc++] = multiwfn_pid;
    if (with_transport) {
        (void)snprintf(volume_fd, sizeof(volume_fd), "%d", volume_pipe[0]);
        (void)snprintf(ack_fd, sizeof(ack_fd), "%d", ack_pipe[1]);
        (void)snprintf(response_fd, sizeof(response_fd), "%d", response_pipe[0]);
        (void)snprintf(request_fd, sizeof(request_fd), "%d", request_pipe[1]);
        argv[argc++] = (char *)"--volume-read-pipe";
        argv[argc++] = volume_fd;
        argv[argc++] = (char *)"--volume-ack-pipe";
        argv[argc++] = ack_fd;
        argv[argc++] = (char *)"--control-read-pipe";
        argv[argc++] = response_fd;
        argv[argc++] = (char *)"--control-write-pipe";
        argv[argc++] = request_fd;
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
        mwfn_close_fd(&request_pipe[0]);
        mwfn_close_fd(&request_pipe[1]);
        mwfn_close_fd(&response_pipe[0]);
        mwfn_close_fd(&response_pipe[1]);
        return error_code;
    }
    if (pid == 0) {
        int exec_error;
        mwfn_close_fd(&exec_pipe[0]);
        if (with_transport) {
            mwfn_close_fd(&volume_pipe[1]);
            mwfn_close_fd(&ack_pipe[0]);
            mwfn_close_fd(&request_pipe[0]);
            mwfn_close_fd(&response_pipe[1]);
            (void)mwfn_set_cloexec(volume_pipe[0], 0);
            (void)mwfn_set_cloexec(ack_pipe[1], 0);
            (void)mwfn_set_cloexec(response_pipe[0], 0);
            (void)mwfn_set_cloexec(request_pipe[1], 0);
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
            mwfn_close_fd(&request_pipe[0]);
            mwfn_close_fd(&request_pipe[1]);
            mwfn_close_fd(&response_pipe[0]);
            mwfn_close_fd(&response_pipe[1]);
            do {
                read_bytes = waitpid(pid, &status, 0);
            } while (read_bytes < 0 && errno == EINTR);
            return error_code;
        }
    }
    if (with_transport) {
        mwfn_close_fd(&volume_pipe[0]);
        mwfn_close_fd(&ack_pipe[1]);
        mwfn_close_fd(&request_pipe[1]);
        mwfn_close_fd(&response_pipe[0]);
        *volume_write_out = volume_pipe[1];
        *ack_read_out = ack_pipe[0];
        *request_read_out = request_pipe[0];
        *response_write_out = response_pipe[1];
    }
    *pid_out = pid;
    return 0;
}

static int mwfn_spawn_file_only_posix(const char *executable, const char *frontend,
                                      const char *session, const char *manifest,
                                      pid_t *pid_out) {
    int unused_volume = -1;
    int unused_ack = -1;
    int unused_request = -1;
    int unused_response = -1;
    return mwfn_spawn_posix(executable, frontend, session, manifest, 0, pid_out,
                            &unused_volume, &unused_ack, &unused_request, &unused_response);
}

/* Launch the packaged Rust file chooser and consume its inherited result pipe before waiting. */
static int mwfn_select_file_posix(const char *executable, char *result_utf8, int64_t result_capacity,
                                  int64_t *result_bytes_out, int32_t *picker_status_out) {
    int exec_pipe[2] = {-1, -1};
    int result_pipe[2] = {-1, -1};
    char result_fd[32];
    const char *argv[5];
    pid_t pid;
    int status;
    int exec_error = 0;
    ssize_t read_bytes;
    int error_code = 0;
    int parse_error = 0;
    uint8_t header[MWFN_PICK_HEADER_BYTES];
    uint8_t body[MWFN_PICK_MAX_BODY_BYTES];
    uint16_t picker_status = MWFN_PICK_STATUS_CANCEL;
    uint32_t body_bytes = 0;
    int trailing = 0;
    uint64_t deadline;
    if (result_bytes_out != NULL) *result_bytes_out = 0;
    if (picker_status_out != NULL) *picker_status_out = -1;
    if (executable == NULL || executable[0] == '\0' || result_utf8 == NULL ||
        result_capacity <= 0 || result_bytes_out == NULL || picker_status_out == NULL) {
        return EINVAL;
    }
    result_utf8[0] = '\0';
    if (mwfn_pipe_cloexec(exec_pipe) != 0 || mwfn_pipe_cloexec(result_pipe) != 0) {
        error_code = errno == 0 ? EIO : errno;
        mwfn_close_fd(&exec_pipe[0]);
        mwfn_close_fd(&exec_pipe[1]);
        mwfn_close_fd(&result_pipe[0]);
        mwfn_close_fd(&result_pipe[1]);
        return error_code;
    }
    (void)snprintf(result_fd, sizeof(result_fd), "%d", result_pipe[1]);
    argv[0] = executable;
    argv[1] = "--select-file";
    argv[2] = "--result-pipe";
    argv[3] = result_fd;
    argv[4] = NULL;
    pid = fork();
    if (pid < 0) {
        error_code = errno;
        mwfn_close_fd(&exec_pipe[0]);
        mwfn_close_fd(&exec_pipe[1]);
        mwfn_close_fd(&result_pipe[0]);
        mwfn_close_fd(&result_pipe[1]);
        return error_code;
    }
    if (pid == 0) {
        mwfn_close_fd(&exec_pipe[0]);
        mwfn_close_fd(&result_pipe[0]);
        (void)mwfn_set_cloexec(result_pipe[1], 0);
        execv(executable, (char *const *)argv);
        exec_error = errno == 0 ? EIO : errno;
        while (write(exec_pipe[1], &exec_error, sizeof(exec_error)) < 0 && errno == EINTR) {
        }
        _exit(127);
    }
    mwfn_close_fd(&exec_pipe[1]);
    mwfn_close_fd(&result_pipe[1]);
    do {
        read_bytes = read(exec_pipe[0], &exec_error, sizeof(exec_error));
    } while (read_bytes < 0 && errno == EINTR);
    mwfn_close_fd(&exec_pipe[0]);
    if (read_bytes != 0) {
        error_code = read_bytes == (ssize_t)sizeof(exec_error) && exec_error != 0
                         ? exec_error
                         : EIO;
        mwfn_close_fd(&result_pipe[0]);
        mwfn_reap_terminated(pid);
        return error_code;
    }

    for (;;) {
        struct pollfd descriptor;
        int poll_result;
        descriptor.fd = result_pipe[0];
        descriptor.events = POLLIN;
        descriptor.revents = 0;
        poll_result = poll(&descriptor, 1, -1);
        if (poll_result < 0 && errno == EINTR) continue;
        if (poll_result < 0) {
            error_code = errno;
        } else if ((descriptor.revents & POLLNVAL) != 0) {
            error_code = EBADF;
        } else if ((descriptor.revents & POLLERR) != 0) {
            error_code = EIO;
        }
        if (error_code != 0 || (descriptor.revents & (POLLIN | POLLHUP)) != 0) break;
    }
    if (error_code != 0) {
        mwfn_close_fd(&result_pipe[0]);
        mwfn_reap_terminated(pid);
        return error_code;
    }
    deadline = mwfn_now_ms() + MWFN_PICK_READ_TIMEOUT_MS;
    error_code = mwfn_read_exact_posix_deadline(result_pipe[0], header, sizeof(header), deadline);
    if (error_code == 0) {
        if (!mwfn_picker_header_valid(header, &picker_status, &body_bytes)) {
            parse_error = MWFN_ERR_PROTOCOL;
        } else if (body_bytes > 0U) {
            error_code = mwfn_read_exact_posix_deadline(result_pipe[0], body, body_bytes, deadline);
            if (error_code != 0) {
                parse_error = error_code == ETIMEDOUT ? MWFN_ERR_TIMEOUT : MWFN_ERR_PROTOCOL;
            } else if (!mwfn_picker_body_valid(picker_status, body, body_bytes,
                                               mwfn_get_u32(header + 24))) {
                parse_error = MWFN_ERR_PROTOCOL;
            }
        }
    } else {
        parse_error = error_code == ETIMEDOUT ? MWFN_ERR_TIMEOUT : MWFN_ERR_PROTOCOL;
    }
    if (error_code == 0 || parse_error == MWFN_ERR_PROTOCOL) {
        int drain_error = mwfn_drain_posix_deadline(result_pipe[0], deadline, &trailing);
        if (drain_error == ETIMEDOUT) {
            error_code = ETIMEDOUT;
            parse_error = MWFN_ERR_TIMEOUT;
        } else if (drain_error != 0 && parse_error == 0) {
            parse_error = MWFN_ERR_PROTOCOL;
        }
    }
    mwfn_close_fd(&result_pipe[0]);
    if (parse_error == MWFN_ERR_TIMEOUT || error_code == ETIMEDOUT) {
        mwfn_reap_terminated(pid);
        return MWFN_ERR_TIMEOUT;
    }
    do {
        error_code = (int)waitpid(pid, &status, 0);
    } while (error_code < 0 && errno == EINTR);
    if (error_code < 0) return errno == 0 ? ECHILD : errno;
    if (parse_error != 0 || trailing) return parse_error != 0 ? parse_error : MWFN_ERR_PROTOCOL;
    if (!mwfn_picker_body_valid(picker_status, body, body_bytes, mwfn_get_u32(header + 24))) {
        return MWFN_ERR_PROTOCOL;
    }
    *result_bytes_out = (int64_t)body_bytes;
    *picker_status_out = (int32_t)picker_status;
    if (result_capacity <= (int64_t)body_bytes) return MWFN_ERR_BUFFER;
    memcpy(result_utf8, body, body_bytes);
    result_utf8[body_bytes] = '\0';
    if (WIFEXITED(status)) return 0;
    return WIFSIGNALED(status) ? 128 + WTERMSIG(status) : ECHILD;
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

static int mwfn_drain_win_deadline(HANDLE handle, ULONGLONG deadline, int *had_data_out) {
    uint8_t buffer[4096];
    int had_data = 0;
    for (;;) {
        DWORD available = 0;
        DWORD read_bytes = 0;
        if (!PeekNamedPipe(handle, NULL, 0, NULL, &available, NULL)) {
            DWORD error = GetLastError();
            if (error == ERROR_BROKEN_PIPE) {
                if (had_data_out != NULL) *had_data_out = had_data;
                return 0;
            }
            return (int)error;
        }
        if (available == 0U) {
            if (GetTickCount64() >= deadline) return ETIMEDOUT;
            Sleep(1);
            continue;
        }
        if (!ReadFile(handle, buffer, (DWORD)sizeof(buffer), &read_bytes, NULL)) {
            DWORD error = GetLastError();
            return error == ERROR_BROKEN_PIPE ? 0 : (int)error;
        }
        if (read_bytes == 0U) {
            if (had_data_out != NULL) *had_data_out = had_data;
            return 0;
        }
        had_data = 1;
    }
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

static int mwfn_select_file_windows(const char *executable, char *result_utf8,
                                    int64_t result_capacity, int64_t *result_bytes_out,
                                    int32_t *picker_status_out) {
    const char *names[4];
    char result_handle[32];
    wchar_t *wide_values[4] = {NULL, NULL, NULL, NULL};
    wchar_t *command_line = NULL;
    size_t command_length = 0;
    size_t command_capacity = 0;
    STARTUPINFOEXW startup = {0};
    PROCESS_INFORMATION process = {0};
    SECURITY_ATTRIBUTES security = {sizeof(SECURITY_ATTRIBUTES), NULL, TRUE};
    HANDLE result_read = NULL;
    HANDLE result_write = NULL;
    HANDLE inherited[1] = {NULL};
    LPPROC_THREAD_ATTRIBUTE_LIST attributes = NULL;
    SIZE_T attributes_size = 0;
    int attributes_initialized = 0;
    DWORD wait_result;
    DWORD exit_code = 0;
    int error_code = 0;
    int parse_error = 0;
    int trailing = 0;
    uint8_t header[MWFN_PICK_HEADER_BYTES];
    uint8_t body[MWFN_PICK_MAX_BODY_BYTES];
    uint16_t picker_status = MWFN_PICK_STATUS_CANCEL;
    uint32_t body_bytes = 0;
    ULONGLONG deadline;
    unsigned int index;
    if (result_bytes_out != NULL) *result_bytes_out = 0;
    if (picker_status_out != NULL) *picker_status_out = -1;
    if (executable == NULL || executable[0] == '\0' || result_utf8 == NULL ||
        result_capacity <= 0 || result_bytes_out == NULL || picker_status_out == NULL) {
        return ERROR_INVALID_PARAMETER;
    }
    result_utf8[0] = '\0';
    if (!CreatePipe(&result_read, &result_write, &security, 0) ||
        !SetHandleInformation(result_read, HANDLE_FLAG_INHERIT, 0)) {
        error_code = (int)GetLastError();
        goto cleanup;
    }
    (void)snprintf(result_handle, sizeof(result_handle), "%llu",
                   (unsigned long long)(uintptr_t)result_write);
    names[0] = executable;
    names[1] = "--select-file";
    names[2] = "--result-pipe";
    names[3] = result_handle;
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
    inherited[0] = result_write;
    InitializeProcThreadAttributeList(NULL, 1, 0, &attributes_size);
    attributes = (LPPROC_THREAD_ATTRIBUTE_LIST)malloc(attributes_size);
    if (attributes == NULL || !InitializeProcThreadAttributeList(attributes, 1, 0, &attributes_size)) {
        error_code = attributes == NULL ? ERROR_NOT_ENOUGH_MEMORY : (int)GetLastError();
        goto cleanup;
    }
    attributes_initialized = 1;
    if (!UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherited,
                                   sizeof(inherited), NULL, NULL)) {
        error_code = (int)GetLastError();
        goto cleanup;
    }
    startup.StartupInfo.cb = sizeof(startup.StartupInfo);
    startup.lpAttributeList = attributes;
    if (!CreateProcessW(wide_values[0], command_line, NULL, NULL, TRUE,
                        EXTENDED_STARTUPINFO_PRESENT, NULL, NULL, &startup.StartupInfo,
                        &process)) {
        error_code = (int)GetLastError();
        goto cleanup;
    }
    CloseHandle(result_write);
    result_write = NULL;
    for (;;) {
        DWORD available = 0;
        if (!PeekNamedPipe(result_read, NULL, 0, NULL, &available, NULL)) {
            error_code = (int)GetLastError();
            goto cleanup;
        }
        if (available > 0U) break;
        if (WaitForSingleObject(process.hProcess, 20U) == WAIT_FAILED) {
            error_code = (int)GetLastError();
            goto cleanup;
        }
    }
    deadline = GetTickCount64() + MWFN_PICK_READ_TIMEOUT_MS;
    error_code = mwfn_read_exact_win_deadline(result_read, header, sizeof(header), deadline);
    if (error_code == 0) {
        if (!mwfn_picker_header_valid(header, &picker_status, &body_bytes)) {
            parse_error = MWFN_ERR_PROTOCOL;
        } else if (body_bytes > 0U) {
            error_code = mwfn_read_exact_win_deadline(result_read, body, body_bytes, deadline);
            if (error_code != 0) {
                parse_error = error_code == ETIMEDOUT ? MWFN_ERR_TIMEOUT : MWFN_ERR_PROTOCOL;
            } else if (!mwfn_picker_body_valid(picker_status, body, body_bytes,
                                               mwfn_get_u32(header + 24))) {
                parse_error = MWFN_ERR_PROTOCOL;
            }
        }
    } else {
        parse_error = error_code == ETIMEDOUT ? MWFN_ERR_TIMEOUT : MWFN_ERR_PROTOCOL;
    }
    if (error_code == 0 || parse_error == MWFN_ERR_PROTOCOL) {
        int drain_error = mwfn_drain_win_deadline(result_read, deadline, &trailing);
        if (drain_error == ETIMEDOUT) {
            error_code = ETIMEDOUT;
            parse_error = MWFN_ERR_TIMEOUT;
        } else if (drain_error != 0 && parse_error == 0) {
            parse_error = MWFN_ERR_PROTOCOL;
        }
    }
    CloseHandle(result_read);
    result_read = NULL;
    if (parse_error == MWFN_ERR_TIMEOUT || error_code == ETIMEDOUT) {
        TerminateProcess(process.hProcess, 1U);
        (void)WaitForSingleObject(process.hProcess, INFINITE);
        error_code = MWFN_ERR_TIMEOUT;
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
    if (parse_error != 0 || trailing) {
        error_code = parse_error != 0 ? parse_error : MWFN_ERR_PROTOCOL;
        goto cleanup;
    }
    if (!mwfn_picker_body_valid(picker_status, body, body_bytes, mwfn_get_u32(header + 24))) {
        error_code = MWFN_ERR_PROTOCOL;
        goto cleanup;
    }
    *result_bytes_out = (int64_t)body_bytes;
    *picker_status_out = (int32_t)picker_status;
    if (result_capacity <= (int64_t)body_bytes) {
        error_code = MWFN_ERR_BUFFER;
        goto cleanup;
    }
    memcpy(result_utf8, body, body_bytes);
    result_utf8[body_bytes] = '\0';
    error_code = 0;

cleanup:
    if (process.hThread != NULL) CloseHandle(process.hThread);
    if (process.hProcess != NULL) CloseHandle(process.hProcess);
    mwfn_close_handle(&result_read);
    mwfn_close_handle(&result_write);
    if (attributes_initialized) {
        DeleteProcThreadAttributeList(attributes);
    }
    free(attributes);
    free(command_line);
    for (index = 0; index < 4U; ++index) free(wide_values[index]);
    return error_code;
}

static int mwfn_spawn_windows(const char *executable, const char *frontend, const char *session,
                              const char *manifest, int with_transport, HANDLE *volume_write_out,
                              HANDLE *ack_read_out, HANDLE *request_read_out,
                              HANDLE *response_write_out, PROCESS_INFORMATION *process_out) {
    const char *names[17];
    char volume_handle[32];
    char ack_handle[32];
    char control_read_handle[32];
    char control_write_handle[32];
    char multiwfn_pid[32];
    wchar_t *wide_values[17] = {0};
    wchar_t *command_line = NULL;
    size_t command_length = 0;
    size_t command_capacity = 0;
    unsigned int count = 0;
    SECURITY_ATTRIBUTES security = {sizeof(SECURITY_ATTRIBUTES), NULL, TRUE};
    HANDLE volume_read = NULL;
    HANDLE volume_write = NULL;
    HANDLE ack_read = NULL;
    HANDLE ack_write = NULL;
    HANDLE request_read = NULL;
    HANDLE request_write = NULL;
    HANDLE response_read = NULL;
    HANDLE response_write = NULL;
    HANDLE inherited[7] = {NULL, NULL, NULL, NULL, NULL, NULL, NULL};
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
    (void)snprintf(multiwfn_pid, sizeof(multiwfn_pid), "%lu",
                   (unsigned long)GetCurrentProcessId());
    names[count++] = "--multiwfn-pid";
    names[count++] = multiwfn_pid;
    if (with_transport) {
        if (!CreatePipe(&volume_read, &volume_write, &security, 0) ||
            !CreatePipe(&ack_read, &ack_write, &security, 0) ||
            !CreatePipe(&request_read, &request_write, &security, 0) ||
            !CreatePipe(&response_read, &response_write, &security, 0)) {
            error_code = (int)GetLastError();
            goto cleanup;
        }
        if (!SetHandleInformation(volume_write, HANDLE_FLAG_INHERIT, 0) ||
            !SetHandleInformation(ack_read, HANDLE_FLAG_INHERIT, 0) ||
            !SetHandleInformation(request_read, HANDLE_FLAG_INHERIT, 0) ||
            !SetHandleInformation(response_write, HANDLE_FLAG_INHERIT, 0)) {
            error_code = (int)GetLastError();
            goto cleanup;
        }
        (void)snprintf(volume_handle, sizeof(volume_handle), "%llu",
                       (unsigned long long)(uintptr_t)volume_read);
        (void)snprintf(ack_handle, sizeof(ack_handle), "%llu",
                       (unsigned long long)(uintptr_t)ack_write);
        (void)snprintf(control_read_handle, sizeof(control_read_handle), "%llu",
                       (unsigned long long)(uintptr_t)response_read);
        (void)snprintf(control_write_handle, sizeof(control_write_handle), "%llu",
                       (unsigned long long)(uintptr_t)request_write);
        names[count++] = "--volume-read-pipe";
        names[count++] = volume_handle;
        names[count++] = "--volume-ack-pipe";
        names[count++] = ack_handle;
        names[count++] = "--control-read-pipe";
        names[count++] = control_read_handle;
        names[count++] = "--control-write-pipe";
        names[count++] = control_write_handle;
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
        const SIZE_T inherited_count = with_transport ? 7U : 3U;
        inherited[3] = with_transport ? volume_read : NULL;
        inherited[4] = with_transport ? ack_write : NULL;
        inherited[5] = with_transport ? response_read : NULL;
        inherited[6] = with_transport ? request_write : NULL;
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
        CloseHandle(response_read);
        response_read = NULL;
        CloseHandle(request_write);
        request_write = NULL;
        *volume_write_out = volume_write;
        *ack_read_out = ack_read;
        *request_read_out = request_read;
        *response_write_out = response_write;
        volume_write = NULL;
        ack_read = NULL;
        request_read = NULL;
        response_write = NULL;
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
    mwfn_close_handle(&request_read);
    mwfn_close_handle(&request_write);
    mwfn_close_handle(&response_read);
    mwfn_close_handle(&response_write);
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
                             intptr_t *request_read_out, intptr_t *response_write_out,
                             int *transport_error_out) {
    int transport_error = 0;
    if (volume_write_out != NULL) *volume_write_out = (intptr_t)-1;
    if (ack_read_out != NULL) *ack_read_out = (intptr_t)-1;
    if (request_read_out != NULL) *request_read_out = (intptr_t)-1;
    if (response_write_out != NULL) *response_write_out = (intptr_t)-1;
    if (transport_error_out != NULL) *transport_error_out = 0;
    if (volume_write_out == NULL || ack_read_out == NULL || request_read_out == NULL ||
        response_write_out == NULL || transport_error_out == NULL ||
        executable_utf8 == NULL || frontend_utf8 == NULL || session_utf8 == NULL ||
        manifest_utf8 == NULL) {
        if (transport_error_out != NULL) *transport_error_out = EINVAL;
        return -1;
    }
#ifdef _WIN32
    {
        HANDLE volume_write = NULL;
        HANDLE ack_read = NULL;
        HANDLE request_read = NULL;
        HANDLE response_write = NULL;
        PROCESS_INFORMATION process = {0};
        if (mwfn_cube_fallback_enabled()) {
            int diagnostic_error = mwfn_spawn_windows(
                executable_utf8, frontend_utf8, session_utf8, manifest_utf8, 0,
                NULL, NULL, NULL, NULL, &process);
            if (diagnostic_error != 0) {
                *transport_error_out = diagnostic_error;
                return -1;
            }
            CloseHandle(process.hThread);
            CloseHandle(process.hProcess);
            return 0;
        }
        int error_code = mwfn_spawn_windows(executable_utf8, frontend_utf8, session_utf8,
                                            manifest_utf8, 1, &volume_write, &ack_read,
                                            &request_read, &response_write, &process);
        if (error_code == 0) {
            uint8_t ready[MWFN_READY_BYTES];
            uint8_t control_ready[MWFN_CONTROL_HEADER_BYTES];
            transport_error = mwfn_read_exact_win(ack_read, ready, sizeof(ready),
                                                  MWFN_READY_TIMEOUT_MS);
            if (transport_error == 0 && !mwfn_valid_ready(ready)) transport_error = ERROR_INVALID_DATA;
            if (transport_error == 0) {
                transport_error = mwfn_read_exact_win(request_read, control_ready,
                                                      sizeof(control_ready),
                                                      MWFN_READY_TIMEOUT_MS);
            }
            if (transport_error == 0 &&
                (!mwfn_control_header_valid(control_ready) ||
                 mwfn_get_u16(control_ready + 12) != 1U)) {
                transport_error = ERROR_INVALID_DATA;
            }
            if (transport_error == 0) {
                CloseHandle(process.hThread);
                CloseHandle(process.hProcess);
                *volume_write_out = (intptr_t)(uintptr_t)volume_write;
                *ack_read_out = (intptr_t)(uintptr_t)ack_read;
                *request_read_out = (intptr_t)(uintptr_t)request_read;
                *response_write_out = (intptr_t)(uintptr_t)response_write;
                return 0;
            }
            TerminateProcess(process.hProcess, 1);
            (void)WaitForSingleObject(process.hProcess, INFINITE);
            CloseHandle(process.hThread);
            CloseHandle(process.hProcess);
            mwfn_close_handle(&volume_write);
            mwfn_close_handle(&ack_read);
            mwfn_close_handle(&request_read);
            mwfn_close_handle(&response_write);
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
                                        manifest_utf8, 0, NULL, NULL, NULL, NULL, &process);
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
        int request_read = -1;
        int response_write = -1;
        if (mwfn_cube_fallback_enabled()) {
            int diagnostic_error = mwfn_spawn_file_only_posix(
                executable_utf8, frontend_utf8, session_utf8, manifest_utf8, &fallback_pid);
            if (diagnostic_error == 0) diagnostic_error = mwfn_register_reaper(fallback_pid);
            if (diagnostic_error != 0) {
                if (fallback_pid >= 0) mwfn_reap_terminated(fallback_pid);
                *transport_error_out = diagnostic_error;
                return -1;
            }
            return 0;
        }
        int error_code = mwfn_spawn_posix(executable_utf8, frontend_utf8, session_utf8,
                                          manifest_utf8, 1, &pid, &volume_write, &ack_read,
                                          &request_read, &response_write);
        if (error_code == 0) {
            uint8_t ready[MWFN_READY_BYTES];
            uint8_t control_ready[MWFN_CONTROL_HEADER_BYTES];
            error_code = mwfn_read_exact_posix(ack_read, ready, sizeof(ready),
                                               MWFN_READY_TIMEOUT_MS);
            if (error_code == 0 && !mwfn_valid_ready(ready)) error_code = EPROTO;
            if (error_code == 0) {
                error_code = mwfn_read_exact_posix(request_read, control_ready,
                                                   sizeof(control_ready),
                                                   MWFN_READY_TIMEOUT_MS);
            }
            if (error_code == 0 &&
                (!mwfn_control_header_valid(control_ready) ||
                 mwfn_get_u16(control_ready + 12) != 1U)) {
                error_code = EPROTO;
            }
            if (error_code == 0) {
                error_code = mwfn_register_reaper(pid);
                if (error_code == 0) {
                    *volume_write_out = (intptr_t)volume_write;
                    *ack_read_out = (intptr_t)ack_read;
                    *request_read_out = (intptr_t)request_read;
                    *response_write_out = (intptr_t)response_write;
                    return 0;
                }
            }
            mwfn_close_fd(&volume_write);
            mwfn_close_fd(&ack_read);
            mwfn_close_fd(&request_read);
            mwfn_close_fd(&response_write);
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

int multiwfn_matterviz_select_file(const char *executable_utf8, char *result_utf8,
                                   int64_t result_capacity, int64_t *result_bytes_out,
                                   int32_t *picker_status_out) {
    if (executable_utf8 == NULL || result_utf8 == NULL || result_capacity <= 0 ||
        result_bytes_out == NULL || picker_status_out == NULL) {
        return EINVAL;
    }
#ifdef _WIN32
    return mwfn_select_file_windows(executable_utf8, result_utf8, result_capacity,
                                    result_bytes_out, picker_status_out);
#else
    return mwfn_select_file_posix(executable_utf8, result_utf8, result_capacity,
                                  result_bytes_out, picker_status_out);
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
        (quantity_kind < 1 || quantity_kind > 4) ||
        ((quantity_kind == 1 && value_unit != 1) ||
         (quantity_kind == 2 && value_unit != 2) ||
         (quantity_kind == 3 && value_unit != 3) ||
         (quantity_kind == 4 && value_unit != 4)) || origin == NULL ||
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

static int mwfn_control_read_exact(intptr_t pipe_value, uint8_t *bytes, size_t length,
                                   mwfn_stream_deadline_t deadline) {
#ifdef _WIN32
    HANDLE handle = (HANDLE)(uintptr_t)pipe_value;
    if (handle == NULL || handle == INVALID_HANDLE_VALUE || length > UINT32_MAX) {
        return MWFN_ERR_HANDLE;
    }
    return mwfn_read_exact_win_deadline(handle, bytes, (DWORD)length, deadline);
#else
    if (pipe_value < 0) return MWFN_ERR_HANDLE;
    return mwfn_read_exact_posix_deadline((int)pipe_value, bytes, length, deadline);
#endif
}

static int mwfn_control_wait_readable(intptr_t pipe_value, uint32_t timeout_ms) {
#ifdef _WIN32
    HANDLE handle = (HANDLE)(uintptr_t)pipe_value;
    const ULONGLONG deadline = GetTickCount64() + timeout_ms;
    if (handle == NULL || handle == INVALID_HANDLE_VALUE) return MWFN_ERR_HANDLE;
    for (;;) {
        DWORD available = 0;
        if (!PeekNamedPipe(handle, NULL, 0, NULL, &available, NULL)) {
            return (int)GetLastError();
        }
        if (available > 0U) return 0;
        if (GetTickCount64() >= deadline) return ETIMEDOUT;
        Sleep(5U);
    }
#else
    struct pollfd descriptor;
    const uint64_t deadline = mwfn_now_ms() + timeout_ms;
    if (pipe_value < 0) return MWFN_ERR_HANDLE;
    descriptor.fd = (int)pipe_value;
    descriptor.events = POLLIN;
    descriptor.revents = 0;
    for (;;) {
        const uint64_t now = mwfn_now_ms();
        int result;
        int wait_ms;
        if (now >= deadline) return ETIMEDOUT;
        wait_ms = (int)(deadline - now > INT_MAX ? INT_MAX : deadline - now);
        result = poll(&descriptor, 1, wait_ms);
        if (result < 0 && errno == EINTR) continue;
        if (result < 0) return errno;
        if (result == 0) return ETIMEDOUT;
        if ((descriptor.revents & POLLNVAL) != 0) return EBADF;
        if ((descriptor.revents & POLLERR) != 0) return EIO;
        if ((descriptor.revents & (POLLIN | POLLHUP)) != 0) return 0;
    }
#endif
}

int multiwfn_matterviz_control_send(intptr_t response_write, int32_t message_type,
                                    int64_t request_id, const char *body,
                                    int64_t body_bytes, uint32_t timeout_ms) {
    uint8_t header[MWFN_CONTROL_HEADER_BYTES] = {0};
    mwfn_stream_deadline_t deadline;
    uint16_t flags;
    int error_code;
    if (message_type < 1 || message_type > 6 || request_id < 0 || body_bytes < 0 ||
        (body_bytes > 0 && body == NULL) || timeout_ms == 0U) {
        return MWFN_ERR_INVALID;
    }
    flags = body_bytes == 0
                ? MWFN_CONTROL_FLAG_HEADER_CRC
                : (MWFN_CONTROL_FLAG_HEADER_CRC | MWFN_CONTROL_FLAG_BODY_CRC);
    if (!mwfn_control_fields_valid((uint16_t)message_type, flags, (uint64_t)request_id,
                                   (uint64_t)body_bytes)) {
        return MWFN_ERR_INVALID;
    }
    memcpy(header, "MWFNCTL\0", 8U);
    mwfn_put_u16(header + 8, 1U);
    mwfn_put_u16(header + 12, (uint16_t)message_type);
    mwfn_put_u16(header + 14, flags);
    mwfn_put_u32(header + 16, MWFN_CONTROL_HEADER_BYTES);
    mwfn_put_u64(header + 20, (uint64_t)request_id);
    mwfn_put_u64(header + 28, (uint64_t)body_bytes);
    if (body_bytes > 0) {
        mwfn_put_u32(header + 40, mwfn_crc32c((const uint8_t *)body, (size_t)body_bytes));
    }
    mwfn_put_u32(header + 36, mwfn_crc32c(header, sizeof(header)));
    deadline = mwfn_stream_deadline(timeout_ms);
    error_code = mwfn_stream_write(response_write, header, sizeof(header), deadline);
    if (error_code == ETIMEDOUT) return MWFN_ERR_TIMEOUT;
    if (error_code != 0) return error_code;
    if (body_bytes > 0) {
        error_code = mwfn_stream_write(response_write, (const uint8_t *)body,
                                       (size_t)body_bytes, deadline);
        if (error_code == ETIMEDOUT) return MWFN_ERR_TIMEOUT;
        if (error_code != 0) return error_code;
    }
    return 0;
}

int multiwfn_matterviz_control_receive(intptr_t request_read, int32_t *message_type_out,
                                       int64_t *request_id_out, char *body,
                                       int64_t body_capacity, int64_t *body_bytes_out,
                                       uint32_t timeout_ms) {
    uint8_t header[MWFN_CONTROL_HEADER_BYTES];
    mwfn_stream_deadline_t deadline;
    uint64_t body_bytes;
    int error_code;
    if (message_type_out == NULL || request_id_out == NULL || body_bytes_out == NULL ||
        body_capacity < 0 || timeout_ms == 0U) {
        return MWFN_ERR_INVALID;
    }
    *message_type_out = 0;
    *request_id_out = 0;
    *body_bytes_out = 0;
    error_code = mwfn_control_wait_readable(request_read, timeout_ms);
    if (error_code == ETIMEDOUT) return MWFN_ERR_TIMEOUT;
    if (error_code != 0) return error_code;
    deadline = mwfn_stream_deadline(MWFN_CONTROL_FRAME_TIMEOUT_MS);
    error_code = mwfn_control_read_exact(request_read, header, sizeof(header), deadline);
    if (error_code == ETIMEDOUT) return MWFN_ERR_PROTOCOL;
    if (error_code != 0) return error_code;
    if (!mwfn_control_header_valid(header)) return MWFN_ERR_PROTOCOL;
    body_bytes = mwfn_get_u64(header + 28);
    if (body_bytes > (uint64_t)INT64_MAX ||
        (body_bytes > 0U &&
         (body == NULL || body_capacity <= 0 || body_bytes >= (uint64_t)body_capacity))) {
        return MWFN_ERR_BUFFER;
    }
    if (body_bytes > 0U) {
        error_code = mwfn_control_read_exact(request_read, (uint8_t *)body,
                                             (size_t)body_bytes, deadline);
        if (error_code == ETIMEDOUT) return MWFN_ERR_PROTOCOL;
        if (error_code != 0) return error_code;
        if (mwfn_crc32c((const uint8_t *)body, (size_t)body_bytes) !=
            mwfn_get_u32(header + 40)) {
            return MWFN_ERR_PROTOCOL;
        }
        if (memchr(body, 0, (size_t)body_bytes) != NULL ||
            !mwfn_picker_utf8_valid((const uint8_t *)body, (size_t)body_bytes)) {
            return MWFN_ERR_PROTOCOL;
        }
        body[body_bytes] = '\0';
    } else if (body != NULL && body_capacity > 0) {
        body[0] = '\0';
    }
    *message_type_out = (int32_t)mwfn_get_u16(header + 12);
    *request_id_out = (int64_t)mwfn_get_u64(header + 20);
    *body_bytes_out = (int64_t)body_bytes;
    return 0;
}

void multiwfn_matterviz_control_close(intptr_t *request_read_io,
                                      intptr_t *response_write_io) {
    if (request_read_io != NULL) {
#ifdef _WIN32
        HANDLE handle = (HANDLE)(uintptr_t)*request_read_io;
        if (handle != NULL && handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
#else
        if (*request_read_io >= 0) (void)close((int)*request_read_io);
#endif
        *request_read_io = (intptr_t)-1;
    }
    if (response_write_io != NULL) {
#ifdef _WIN32
        HANDLE handle = (HANDLE)(uintptr_t)*response_write_io;
        if (handle != NULL && handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
#else
        if (*response_write_io >= 0) (void)close((int)*response_write_io);
#endif
        *response_write_io = (intptr_t)-1;
    }
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
