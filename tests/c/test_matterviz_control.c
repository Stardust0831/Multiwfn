#define _POSIX_C_SOURCE 200809L

#include <assert.h>
#include <errno.h>
#include <pthread.h>
#include <stdint.h>
#include <string.h>
#include <unistd.h>

int multiwfn_matterviz_control_send(intptr_t response_write, int32_t message_type,
                                    int64_t request_id, const char *body,
                                    int64_t body_bytes, uint32_t timeout_ms);
int multiwfn_matterviz_control_receive(intptr_t request_read, int32_t *message_type_out,
                                       int64_t *request_id_out, char *body,
                                       int64_t body_capacity, int64_t *body_bytes_out,
                                       uint32_t timeout_ms);
void multiwfn_matterviz_control_close(intptr_t *request_read_io,
                                      intptr_t *response_write_io);
intptr_t multiwfn_matterviz_control_buffer_create(void);
int multiwfn_matterviz_control_buffer_append(intptr_t handle, const void *bytes, int64_t length);
int multiwfn_matterviz_control_buffer_clear(intptr_t handle);
int multiwfn_matterviz_control_buffer_send(intptr_t handle, intptr_t response_write,
                                           int32_t message_type, int64_t request_id,
                                           uint32_t timeout_ms);
void multiwfn_matterviz_control_buffer_destroy(intptr_t *handle_io);

#define HEADER_BYTES 48U
#define ERR_INVALID (-1001)
#define ERR_PROTOCOL (-1002)
#define ERR_TIMEOUT (-1003)
#define ERR_BUFFER (-1007)

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

static void build_frame(uint8_t header[HEADER_BYTES], uint16_t type, uint64_t request_id,
                        const char *body, size_t body_bytes) {
    memset(header, 0, HEADER_BYTES);
    memcpy(header, "MWFNCTL\0", 8U);
    put_u16(header + 8, 1U);
    put_u16(header + 12, type);
    put_u16(header + 14, body_bytes == 0U ? 1U : 3U);
    put_u32(header + 16, HEADER_BYTES);
    put_u64(header + 20, request_id);
    put_u64(header + 28, body_bytes);
    if (body_bytes > 0U) put_u32(header + 40, crc32c((const uint8_t *)body, body_bytes));
    put_u32(header + 36, crc32c(header, HEADER_BYTES));
}

static void test_round_trip(void) {
    static const char body[] =
        "{\"format\":\"multiwfn-matterviz-control\",\"version\":1,\"kind\":\"response\",\"request_id\":42}";
    int pipes[2];
    char received[256];
    int32_t type = 0;
    int64_t request_id = 0;
    int64_t body_bytes = 0;
    assert(pipe(pipes) == 0);
    assert(multiwfn_matterviz_control_send(pipes[1], 4, 42, body,
                                           (int64_t)strlen(body), 1000U) == 0);
    assert(multiwfn_matterviz_control_receive(pipes[0], &type, &request_id, received,
                                              sizeof(received), &body_bytes, 1000U) == 0);
    assert(type == 4);
    assert(request_id == 42);
    assert(body_bytes == (int64_t)strlen(body));
    assert(strcmp(received, body) == 0);
    close(pipes[0]);
    close(pipes[1]);
}

static void test_hello_and_close(void) {
    int pipes[2];
    char received[1] = {'x'};
    int32_t type = 0;
    int64_t request_id = -1;
    int64_t body_bytes = -1;
    intptr_t read_end;
    intptr_t write_end;
    assert(pipe(pipes) == 0);
    assert(multiwfn_matterviz_control_send(pipes[1], 1, 0, NULL, 0, 1000U) == 0);
    assert(multiwfn_matterviz_control_receive(pipes[0], &type, &request_id, received,
                                              sizeof(received), &body_bytes, 1000U) == 0);
    assert(type == 1 && request_id == 0 && body_bytes == 0 && received[0] == '\0');
    read_end = pipes[0];
    write_end = pipes[1];
    multiwfn_matterviz_control_close(&read_end, &write_end);
    assert(read_end == -1 && write_end == -1);
}

static void test_invalid_send_fields(void) {
    static const char body[] = "{}";
    int pipes[2];
    assert(pipe(pipes) == 0);
    assert(multiwfn_matterviz_control_send(pipes[1], 0, 0, body, 2, 1000U) == ERR_INVALID);
    assert(multiwfn_matterviz_control_send(pipes[1], 3, 0, body, 2, 1000U) == ERR_INVALID);
    assert(multiwfn_matterviz_control_send(pipes[1], 2, 1, body, 2, 1000U) == ERR_INVALID);
    assert(multiwfn_matterviz_control_send(pipes[1], 4, 1, NULL, 2, 1000U) == ERR_INVALID);
    close(pipes[0]);
    close(pipes[1]);
}

static void test_corrupt_header_and_body(void) {
    static const char body[] = "{\"kind\":\"request\"}";
    static const char invalid_utf8[] = {(char)0xff, 'x'};
    static const char embedded_nul[] = {'a', '\0', 'b'};
    char corrupt_body[sizeof(body)];
    uint8_t header[HEADER_BYTES];
    int pipes[2];
    char received[64];
    int32_t type;
    int64_t request_id;
    int64_t body_bytes;
    assert(pipe(pipes) == 0);
    build_frame(header, 3U, 7U, body, strlen(body));
    header[9] ^= 1U;
    assert(write_all(pipes[1], header, sizeof(header)) == 0);
    assert(multiwfn_matterviz_control_receive(pipes[0], &type, &request_id, received,
                                              sizeof(received), &body_bytes, 1000U) ==
           ERR_PROTOCOL);
    close(pipes[0]);
    close(pipes[1]);

    assert(pipe(pipes) == 0);
    build_frame(header, 3U, 7U, body, strlen(body));
    memcpy(corrupt_body, body, sizeof(body));
    corrupt_body[1] ^= 1;
    assert(write_all(pipes[1], header, sizeof(header)) == 0);
    assert(write_all(pipes[1], (const uint8_t *)corrupt_body, strlen(body)) == 0);
    assert(multiwfn_matterviz_control_receive(pipes[0], &type, &request_id, received,
                                              sizeof(received), &body_bytes, 1000U) ==
           ERR_PROTOCOL);
    close(pipes[0]);
    close(pipes[1]);

    assert(pipe(pipes) == 0);
    build_frame(header, 3U, 7U, invalid_utf8, sizeof(invalid_utf8));
    assert(write_all(pipes[1], header, sizeof(header)) == 0);
    assert(write_all(pipes[1], (const uint8_t *)invalid_utf8, sizeof(invalid_utf8)) == 0);
    assert(multiwfn_matterviz_control_receive(pipes[0], &type, &request_id, received,
                                              sizeof(received), &body_bytes, 1000U) ==
           ERR_PROTOCOL);
    close(pipes[0]);
    close(pipes[1]);

    assert(pipe(pipes) == 0);
    build_frame(header, 3U, 7U, embedded_nul, sizeof(embedded_nul));
    assert(write_all(pipes[1], header, sizeof(header)) == 0);
    assert(write_all(pipes[1], (const uint8_t *)embedded_nul, sizeof(embedded_nul)) == 0);
    assert(multiwfn_matterviz_control_receive(pipes[0], &type, &request_id, received,
                                              sizeof(received), &body_bytes, 1000U) ==
           ERR_PROTOCOL);
    close(pipes[0]);
    close(pipes[1]);
}

static void test_small_buffer_and_timeout(void) {
    static const char body[] = "{\"kind\":\"request\"}";
    uint8_t header[HEADER_BYTES];
    int pipes[2];
    char received[8];
    int32_t type;
    int64_t request_id;
    int64_t body_bytes;
    assert(pipe(pipes) == 0);
    build_frame(header, 3U, 8U, body, strlen(body));
    assert(write_all(pipes[1], header, sizeof(header)) == 0);
    assert(multiwfn_matterviz_control_receive(pipes[0], &type, &request_id, received,
                                              sizeof(received), &body_bytes, 1000U) == ERR_BUFFER);
    close(pipes[0]);
    close(pipes[1]);

    assert(pipe(pipes) == 0);
    assert(multiwfn_matterviz_control_receive(pipes[0], &type, &request_id, received,
                                              sizeof(received), &body_bytes, 20U) == ERR_TIMEOUT);
    close(pipes[0]);
    close(pipes[1]);
}

struct delayed_frame {
    int fd;
    uint8_t header[HEADER_BYTES];
    const char *body;
    size_t body_bytes;
};

static void *write_delayed_frame(void *opaque) {
    struct delayed_frame *frame = (struct delayed_frame *)opaque;
    const struct timespec delay = {0, 300000000L};
    assert(write_all(frame->fd, frame->header, 7U) == 0);
    assert(nanosleep(&delay, NULL) == 0);
    assert(write_all(frame->fd, frame->header + 7U, HEADER_BYTES - 7U) == 0);
    assert(write_all(frame->fd, (const uint8_t *)frame->body, frame->body_bytes) == 0);
    return NULL;
}

static void test_partial_frame_uses_completion_deadline(void) {
    static const char body[] =
        "{\"format\":\"multiwfn-matterviz-control\",\"version\":1,\"kind\":\"request\",\"request_id\":8,\"command\":\"orbital 1 25000 0.05\"}";
    struct delayed_frame frame;
    pthread_t writer;
    int pipes[2];
    char received[256];
    int32_t type;
    int64_t request_id;
    int64_t body_bytes;
    assert(pipe(pipes) == 0);
    frame.fd = pipes[1];
    frame.body = body;
    frame.body_bytes = strlen(body);
    build_frame(frame.header, 3U, 8U, body, frame.body_bytes);
    assert(pthread_create(&writer, NULL, write_delayed_frame, &frame) == 0);
    assert(multiwfn_matterviz_control_receive(pipes[0], &type, &request_id, received,
                                              sizeof(received), &body_bytes, 200U) == 0);
    assert(type == 3 && request_id == 8 && strcmp(received, body) == 0);
    assert(pthread_join(writer, NULL) == 0);
    close(pipes[0]);
    close(pipes[1]);
}

static void test_control_buffer(void) {
    static const char prefix[] =
        "{\"format\":\"multiwfn-matterviz-control\",\"version\":1,\"kind\":\"response\"}";
    intptr_t handle = multiwfn_matterviz_control_buffer_create();
    int pipes[2];
    char received[256];
    int32_t type = 0;
    int64_t request_id = 0;
    int64_t body_bytes = 0;
    assert(handle > 0);
    assert(multiwfn_matterviz_control_buffer_append(handle, prefix, 20) == 0);
    assert(multiwfn_matterviz_control_buffer_append(handle, prefix + 20,
                                                    (int64_t)strlen(prefix) - 20) == 0);
    assert(multiwfn_matterviz_control_buffer_clear(handle) == 0);
    assert(multiwfn_matterviz_control_buffer_append(handle, prefix, (int64_t)strlen(prefix)) == 0);
    assert(pipe(pipes) == 0);
    assert(multiwfn_matterviz_control_buffer_send(handle, pipes[1], 4, 9, 1000U) == 0);
    assert(multiwfn_matterviz_control_receive(pipes[0], &type, &request_id, received,
                                              sizeof(received), &body_bytes, 1000U) == 0);
    assert(type == 4 && request_id == 9 && body_bytes == (int64_t)strlen(prefix));
    assert(strcmp(received, prefix) == 0);
    close(pipes[0]);
    close(pipes[1]);
    assert(multiwfn_matterviz_control_buffer_append(handle, NULL, -1) == ERR_INVALID);
    assert(multiwfn_matterviz_control_buffer_append(handle, NULL, 1) == ERR_INVALID);
    assert(multiwfn_matterviz_control_buffer_append(handle, prefix,
                                                    INT64_C(67108865)) == ERR_BUFFER);
    multiwfn_matterviz_control_buffer_destroy(&handle);
    assert(handle == -1);
    multiwfn_matterviz_control_buffer_destroy(&handle);
}

int main(void) {
    test_round_trip();
    test_hello_and_close();
    test_invalid_send_fields();
    test_corrupt_header_and_body();
    test_small_buffer_and_timeout();
    test_partial_frame_uses_completion_deadline();
    test_control_buffer();
    return 0;
}
