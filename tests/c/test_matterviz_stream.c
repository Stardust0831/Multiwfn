#define _POSIX_C_SOURCE 200809L

#include <assert.h>
#include <errno.h>
#include <math.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

int multiwfn_matterviz_publish_volume_stream(
    intptr_t volume_write, intptr_t ack_read, int64_t request_id, int64_t volume_id,
    int32_t nx, int32_t ny, int32_t nz, int32_t data_order, int32_t periodic_axes,
    int32_t coordinate_unit, int32_t quantity_kind, int32_t value_unit,
    const double origin[3], const double voxel_axes[9], const double lattice[9],
    const double *samples, int64_t sample_count, uint32_t publish_timeout_ms);

int multiwfn_matterviz_publish_plot_data(
    intptr_t volume_write, intptr_t ack_read, int64_t request_id, int64_t dataset_id,
    const int32_t *semantic_roles, const double *array1, const double *array2,
    const double *array3, const double *array4, const double *array5,
    const int64_t *element_counts, int32_t array_count, uint32_t publish_timeout_ms);

#define HEADER_BYTES 304U
#define ACK_BYTES 64U
#define STREAM_CHUNK 4096U
#define ERR_INVALID (-1001)
#define ERR_TIMEOUT (-1003)

typedef struct {
    int read_fd;
    int ack_fd;
    uint64_t expected_bytes;
    int send_ack;
    int slow;
    int capture;
    uint8_t *frame;
    size_t frame_capacity;
    size_t frame_length;
    int read_error;
    int64_t request_id;
    int64_t volume_id;
    const char *ack_magic;
    uint16_t ack_major;
} reader_args;

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

static void put_u64(uint8_t *dst, uint64_t value) {
    unsigned int index;
    for (index = 0; index < 8U; ++index) dst[index] = (uint8_t)(value >> (8U * index));
}

static uint32_t get_u32(const uint8_t *src) {
    return (uint32_t)src[0] | ((uint32_t)src[1] << 8) |
           ((uint32_t)src[2] << 16) | ((uint32_t)src[3] << 24);
}

static uint16_t get_u16(const uint8_t *src) {
    return (uint16_t)src[0] | (uint16_t)((uint16_t)src[1] << 8);
}

static uint64_t get_u64(const uint8_t *src) {
    uint64_t value = 0;
    unsigned int index;
    for (index = 0; index < 8U; ++index) value |= (uint64_t)src[index] << (8U * index);
    return value;
}

static double get_f64(const uint8_t *src) {
    uint64_t bits = get_u64(src);
    double value;
    memcpy(&value, &bits, sizeof(value));
    return value;
}

static uint32_t crc_update(uint32_t crc, const uint8_t *data, size_t length) {
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
    return ~crc_update(UINT32_MAX, data, length);
}

static int write_all(int fd, const uint8_t *data, size_t length) {
    size_t offset = 0;
    while (offset < length) {
        const ssize_t written = write(fd, data + offset, length - offset);
        if (written < 0 && errno == EINTR) continue;
        if (written <= 0) return -1;
        offset += (size_t)written;
    }
    return 0;
}

static void *reader_main(void *opaque) {
    reader_args *args = (reader_args *)opaque;
    uint8_t buffer[STREAM_CHUNK];
    uint64_t total = 0;
    while (total < args->expected_bytes) {
        size_t request = sizeof(buffer);
        ssize_t received;
        if (args->slow) request = 37U;
        if (request > args->expected_bytes - total) request = (size_t)(args->expected_bytes - total);
        do {
            received = read(args->read_fd, buffer, request);
        } while (received < 0 && errno == EINTR);
        if (received <= 0) {
            args->read_error = received == 0 ? EPIPE : errno;
            return NULL;
        }
        if (args->capture) {
            assert(args->frame_length + (size_t)received <= args->frame_capacity);
            memcpy(args->frame + args->frame_length, buffer, (size_t)received);
            args->frame_length += (size_t)received;
        }
        total += (uint64_t)received;
        if (args->slow) {
            const struct timespec delay = {0, 1000000L};
            (void)nanosleep(&delay, NULL);
        }
    }
    if (args->send_ack) {
        uint8_t ack[ACK_BYTES] = {0};
        memcpy(ack, args->ack_magic, 8U);
        put_u16(ack + 8, args->ack_major);
        put_u16(ack + 12, 8U);
        put_u16(ack + 14, 1U);
        put_u32(ack + 16, ACK_BYTES);
        put_u64(ack + 20, (uint64_t)args->request_id);
        put_u64(ack + 48, (uint64_t)args->volume_id);
        put_u32(ack + 36, crc32c(ack, sizeof(ack)));
        assert(get_u16(ack + 8) == args->ack_major);
        assert(get_u16(ack + 12) == 8U);
        assert(get_u32(ack + 56) == 0U);
        if (write_all(args->ack_fd, ack, sizeof(ack)) != 0) args->read_error = errno;
    }
    return NULL;
}

static void init_metadata(double origin[3], double voxel_axes[9], double lattice[9]) {
    unsigned int index;
    origin[0] = 0.25;
    origin[1] = -0.5;
    origin[2] = 1.0;
    for (index = 0; index < 9U; ++index) {
        voxel_axes[index] = (double)(index + 1U) / 10.0;
        lattice[index] = (double)(index + 11U) / 10.0;
    }
}

static int run_stream(const double *samples, int64_t count, int slow, int send_ack,
                      int capture, uint8_t **frame_out, size_t *frame_length_out) {
    int volume_pipe[2];
    int ack_pipe[2];
    pthread_t reader;
    reader_args args;
    double origin[3];
    double voxel_axes[9];
    double lattice[9];
    int result;
    if (pipe(volume_pipe) != 0 || pipe(ack_pipe) != 0) return -1;
    memset(&args, 0, sizeof(args));
    args.read_fd = volume_pipe[0];
    args.ack_fd = ack_pipe[1];
    args.expected_bytes = HEADER_BYTES + (uint64_t)count * sizeof(double);
    args.send_ack = send_ack;
    args.slow = slow;
    args.capture = capture;
    args.request_id = 42;
    args.volume_id = 1001;
    args.ack_magic = "MWFNVOL\0";
    args.ack_major = 2U;
    if (capture) {
        args.frame_capacity = (size_t)args.expected_bytes;
        args.frame = (uint8_t *)malloc(args.frame_capacity);
        assert(args.frame != NULL);
    }
    assert(pthread_create(&reader, NULL, reader_main, &args) == 0);
    init_metadata(origin, voxel_axes, lattice);
    result = multiwfn_matterviz_publish_volume_stream(
        (intptr_t)volume_pipe[1], (intptr_t)ack_pipe[0], 42, 1001,
        1, 1, (int32_t)count, 1, 0, 1, 1, 1, origin, voxel_axes, lattice,
        samples, count, send_ack ? 5000U : 50U);
    close(volume_pipe[1]);
    close(ack_pipe[0]);
    assert(pthread_join(reader, NULL) == 0);
    close(volume_pipe[0]);
    close(ack_pipe[1]);
    assert(args.read_error == 0 || !send_ack);
    if (frame_out != NULL) {
        *frame_out = args.frame;
        *frame_length_out = args.frame_length;
    } else {
        free(args.frame);
    }
    return result;
}

static void test_exact_frame(void) {
    const double samples[] = {1.0, -2.5, 3.25, 4.0};
    uint8_t *frame = NULL;
    size_t frame_length = 0;
    uint8_t body[sizeof(samples)];
    assert(run_stream(samples, 4, 1, 1, 1, &frame, &frame_length) == 0);
    assert(frame_length == HEADER_BYTES + sizeof(samples));
    put_u64(body + 0, UINT64_C(0x3ff0000000000000));
    put_u64(body + 8, UINT64_C(0xc004000000000000));
    put_u64(body + 16, UINT64_C(0x400a000000000000));
    put_u64(body + 24, UINT64_C(0x4010000000000000));
    assert(frame[8] == 2U && frame[12] == 4U && get_u32(frame + 16) == HEADER_BYTES);
    assert(frame[10] == 0U && frame[14] == 3U && frame[44] == 0U);
    assert(get_u32(frame + 28) == sizeof(samples));
    assert(memcmp(frame + HEADER_BYTES, body, sizeof(body)) == 0);
    assert(crc32c(frame + HEADER_BYTES, sizeof(samples)) == get_u32(frame + 40));
    {
        uint8_t header[HEADER_BYTES];
        memcpy(header, frame, sizeof(header));
        put_u32(header + 36, 0U);
        assert(crc32c(header, sizeof(header)) == get_u32(frame + 36));
    }
    assert(get_u64(frame + 248) == 4U);
    assert(get_u64(frame + 256) == sizeof(samples));
    assert(get_f64(frame + 264) == -2.5);
    assert(get_f64(frame + 272) == 4.0);
    assert(get_f64(frame + 280) == 1.4375);
    assert(get_f64(frame + 288) == 4.0);
    for (size_t index = 296U; index < HEADER_BYTES; ++index) assert(frame[index] == 0U);
    free(frame);
}

static void test_large_stream(void) {
    const int64_t count = 1500001;
    double *samples = (double *)malloc((size_t)count * sizeof(*samples));
    int64_t index;
    assert(samples != NULL);
    for (index = 0; index < count; ++index) samples[index] = (double)(index % 101) - 50.0;
    assert(run_stream(samples, count, 0, 1, 0, NULL, NULL) == 0);
    free(samples);
}

static void test_validation(void) {
    const double valid = 1.0;
    const double invalid = NAN;
    int volume_pipe[2];
    int ack_pipe[2];
    double origin[3];
    double voxel_axes[9];
    double lattice[9];
    init_metadata(origin, voxel_axes, lattice);
    assert(pipe(volume_pipe) == 0 && pipe(ack_pipe) == 0);
    assert(multiwfn_matterviz_publish_volume_stream(
               volume_pipe[1], ack_pipe[0], 1, 1, 1, 1, 1, 1, 0, 1, 1, 1,
               origin, voxel_axes, lattice, &invalid, 1, 100U) == ERR_INVALID);
    assert(multiwfn_matterviz_publish_volume_stream(
               volume_pipe[1], ack_pipe[0], 1, 1, INT32_MAX, INT32_MAX, INT32_MAX,
               1, 0, 1, 1, 1, origin, voxel_axes, lattice, &valid, 1, 100U) != 0);
    close(volume_pipe[0]);
    close(volume_pipe[1]);
    close(ack_pipe[0]);
    close(ack_pipe[1]);
}

static void test_timeout_and_broken_pipe(void) {
    const double sample = 1.0;
    int volume_pipe[2];
    int ack_pipe[2];
    double origin[3];
    double voxel_axes[9];
    double lattice[9];
    init_metadata(origin, voxel_axes, lattice);
    assert(pipe(volume_pipe) == 0 && pipe(ack_pipe) == 0);
    close(volume_pipe[0]);
    assert(multiwfn_matterviz_publish_volume_stream(
               volume_pipe[1], ack_pipe[0], 1, 1, 1, 1, 1, 1, 0, 1, 1, 1,
               origin, voxel_axes, lattice, &sample, 1, 100U) != 0);
    close(volume_pipe[1]);
    close(ack_pipe[0]);
    close(ack_pipe[1]);
    assert(run_stream(&sample, 1, 0, 0, 0, NULL, NULL) == ERR_TIMEOUT);
}

static void test_plot_data_stream(void) {
    const int64_t count = 1500001;
    const uint64_t header_bytes = 80U;
    int data_pipe[2];
    int ack_pipe[2];
    pthread_t reader;
    reader_args args;
    double *values = (double *)malloc((size_t)count * sizeof(*values));
    int result;
    const int32_t roles[] = {1, 2};
    const int64_t counts[] = {count, count};
    int64_t index;
    assert(values != NULL);
    for (index = 0; index < count; ++index) values[index] = (double)(index % 97) / 3.0;
    assert(pipe(data_pipe) == 0 && pipe(ack_pipe) == 0);
    memset(&args, 0, sizeof(args));
    args.read_fd = data_pipe[0];
    args.ack_fd = ack_pipe[1];
    args.expected_bytes = header_bytes + 64U + 2U * (uint64_t)count * sizeof(double);
    args.send_ack = 0;
    args.capture = 1;
    args.frame_capacity = (size_t)args.expected_bytes;
    args.frame = (uint8_t *)malloc(args.frame_capacity);
    assert(args.frame != NULL);
    args.send_ack = 1;
    args.request_id = 9001;
    args.volume_id = 9001;
    args.ack_magic = "MWFNP2D\0";
    args.ack_major = 1U;
    assert(pthread_create(&reader, NULL, reader_main, &args) == 0);
    result = multiwfn_matterviz_publish_plot_data(
        data_pipe[1], ack_pipe[0], 9001, 9001, roles, values, values, NULL, NULL, NULL, counts, 2, 5000U);
    close(data_pipe[1]);
    close(ack_pipe[0]);
    assert(pthread_join(reader, NULL) == 0);
    assert(result == 0);
    assert(args.frame_length == args.expected_bytes);
    assert(memcmp(args.frame, "MWFNP2D\0", 8U) == 0);
    assert(get_u16(args.frame + 8) == 1U && get_u16(args.frame + 12) == 1U);
    assert(get_u32(args.frame + 16) == header_bytes);
    assert(get_u64(args.frame + 20) == 9001U);
    assert(get_u32(args.frame + 28) == 2U);
    assert(get_u64(args.frame + 36) == 64U);
    assert(get_u64(args.frame + 44) == 2U * (uint64_t)count * sizeof(double));
    assert(get_u64(args.frame + 52) == 2U * (uint64_t)count);
    assert(args.frame[80] == 1U && args.frame[112] == 2U);
    assert(crc32c(args.frame + header_bytes + 64U, 2U * (size_t)count * sizeof(double)) ==
           get_u32(args.frame + 64));
    {
        uint8_t header[80];
        memcpy(header, args.frame, sizeof(header));
        put_u32(header + 60, 0U);
        assert(crc32c(header, sizeof(header)) == get_u32(args.frame + 60));
    }
    free(args.frame);
    close(data_pipe[0]);
    close(ack_pipe[1]);
    free(values);
}

static void test_plot_data_validation_and_timeout(void) {
    const double valid = 1.0;
    const double invalid = NAN;
    int data_pipe[2];
    int ack_pipe[2];
    const int32_t valid_role = 1;
    const int32_t invalid_role = 9;
    const double *valid_array = &valid;
    const double *invalid_array = &invalid;
    const int64_t count = 1;
    assert(pipe(data_pipe) == 0 && pipe(ack_pipe) == 0);
    assert(multiwfn_matterviz_publish_plot_data(
               data_pipe[1], ack_pipe[0], 1, 1, &valid_role, invalid_array, NULL, NULL, NULL, NULL, &count, 1, 100U) == ERR_INVALID);
    assert(multiwfn_matterviz_publish_plot_data(
               data_pipe[1], ack_pipe[0], 0, 1, &valid_role, valid_array, NULL, NULL, NULL, NULL, &count, 1, 100U) == ERR_INVALID);
    assert(multiwfn_matterviz_publish_plot_data(
               data_pipe[1], ack_pipe[0], 1, 1, &invalid_role, valid_array, NULL, NULL, NULL, NULL, &count, 1, 100U) == ERR_INVALID);
    assert(multiwfn_matterviz_publish_plot_data(
               data_pipe[1], ack_pipe[0], 1, 1, &valid_role, valid_array, NULL, NULL, NULL, NULL, &count, 1, 20U) == ERR_TIMEOUT);
    close(data_pipe[0]);
    close(data_pipe[1]);
    close(ack_pipe[0]);
    close(ack_pipe[1]);
}

int main(void) {
    test_exact_frame();
    test_large_stream();
    test_validation();
    test_timeout_and_broken_pipe();
    test_plot_data_stream();
    test_plot_data_validation_and_timeout();
    puts("matterviz stream tests passed");
    return 0;
}
