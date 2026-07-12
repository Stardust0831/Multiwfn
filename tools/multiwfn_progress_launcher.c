#include <ctype.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <direct.h>
#include <windows.h>
#define PATH_SEP '\\'
#else
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#define PATH_SEP '/'
#endif

#ifndef MULTIWFN_BACKEND_BASENAME
#define MULTIWFN_BACKEND_BASENAME "Multiwfn_QtGUI.backend"
#endif

#define PATH_CAP 4096
#define RECORD_CAP 8192

typedef struct {
    char session[PATH_CAP];
    char token[65];
    char phase[33];
    int phase_start;
    int phase_end;
} progress_state;

static int path_join(char *out, size_t size, const char *left, const char *right) {
    return snprintf(out, size, "%s%c%s", left, PATH_SEP, right) < (int)size ? 0 : -1;
}

static void parent_dir(char *path) {
    char *slash = strrchr(path, '/');
#ifdef _WIN32
    char *backslash = strrchr(path, '\\');
    if (!slash || (backslash && backslash > slash)) slash = backslash;
#endif
    if (slash) *slash = '\0';
}

static int executable_path(char *out, size_t size, const char *argv0) {
#ifdef _WIN32
    DWORD length = GetModuleFileNameA(NULL, out, (DWORD)size);
    return length > 0 && length < size ? 0 : -1;
#elif defined(__APPLE__)
    return realpath(argv0, out) ? 0 : -1;
#else
    (void)argv0;
    ssize_t length = readlink("/proc/self/exe", out, size - 1);
    if (length < 0 || (size_t)length >= size - 1) return -1;
    out[length] = '\0';
    return 0;
#endif
}

static void ensure_session_dir(const char *path) {
#ifdef _WIN32
    _mkdir(path);
#else
    mkdir(path, 0700);
#endif
}

static void set_environment(const char *name, const char *value) {
#ifdef _WIN32
    _putenv_s(name, value);
#else
    setenv(name, value, 1);
#endif
}

static int valid_word(const char *text, size_t max_length) {
    size_t length = strlen(text);
    if (length == 0 || length > max_length) return 0;
    for (size_t index = 0; index < length; ++index) {
        unsigned char value = (unsigned char)text[index];
        if (!isalnum(value) && value != '_' && value != '-') return 0;
    }
    return 1;
}

static void write_progress(progress_state *state, int phase_progress) {
    char target[PATH_CAP], temporary[PATH_CAP];
    if (!state->token[0]) return;
    if (phase_progress < 0) phase_progress = 0;
    if (phase_progress > 100) phase_progress = 100;
    int overall = state->phase_start
        + (state->phase_end - state->phase_start) * phase_progress / 100;
    char filename[128];
    snprintf(filename, sizeof(filename), "esp_progress_%s.json", state->token);
    if (path_join(target, sizeof(target), state->session, filename) != 0) return;
    if (strlen(target) + 5 > sizeof(temporary)) return;
    strcpy(temporary, target);
    strcat(temporary, ".tmp");
    FILE *file = fopen(temporary, "wb");
    if (!file) return;
    fprintf(file, "{\"phase\":\"%s\",\"phaseProgress\":%d,\"progress\":%d}",
            state->phase, phase_progress, overall);
    fclose(file);
#ifdef _WIN32
    MoveFileExA(temporary, target, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH);
#else
    rename(temporary, target);
#endif
}

static void parse_record(progress_state *state, const char *record) {
    char token[65], phase[33], extra;
    int start, end;
    if (sscanf(record, " MULTIWFN_GUI_PROGRESS %64s %32s %d %d %c",
               token, phase, &start, &end, &extra) == 4
        && valid_word(token, 64) && valid_word(phase, 32)) {
        strcpy(state->token, token);
        strcpy(state->phase, phase);
        state->phase_start = start;
        state->phase_end = end;
        write_progress(state, strcmp(phase, "complete") == 0 ? 100 : 0);
        return;
    }
    const char *progress = strstr(record, "Progress:");
    const char *percent = progress ? strchr(progress, '%') : NULL;
    if (percent && state->token[0]) {
        const char *number = percent;
        while (number > progress && (isdigit((unsigned char)number[-1]) || number[-1] == '.')) --number;
        write_progress(state, (int)(strtod(number, NULL) + 0.5));
    }
}

static void consume_output(progress_state *state, FILE *log, const char *data, size_t length,
                           char *record, size_t *record_length) {
    fwrite(data, 1, length, stdout);
    fflush(stdout);
    if (log) {
        fwrite(data, 1, length, log);
        fflush(log);
    }
    for (size_t index = 0; index < length; ++index) {
        unsigned char value = (unsigned char)data[index];
        if (value == '\r' || value == '\n') {
            record[*record_length] = '\0';
            parse_record(state, record);
            *record_length = 0;
        } else if (*record_length + 1 < RECORD_CAP) {
            record[(*record_length)++] = (char)value;
        }
    }
}

#ifdef _WIN32
static char *quote_windows(const char *value) {
    size_t length = strlen(value), capacity = length * 2 + 3;
    char *quoted = malloc(capacity);
    if (!quoted) return NULL;
    char *out = quoted;
    *out++ = '"';
    size_t backslashes = 0;
    for (const char *cursor = value;; ++cursor) {
        if (*cursor == '\\') {
            ++backslashes;
        } else {
            if (*cursor == '"' || *cursor == '\0') backslashes *= 2;
            while (backslashes--) *out++ = '\\';
            backslashes = 0;
            if (*cursor == '"') *out++ = '\\';
            if (*cursor == '\0') break;
            *out++ = *cursor;
        }
    }
    *out++ = '"';
    *out = '\0';
    return quoted;
}

static int run_child(const char *backend, int argc, char **argv, progress_state *state, FILE *log) {
    HANDLE read_pipe, write_pipe;
    SECURITY_ATTRIBUTES attributes = {sizeof(attributes), NULL, TRUE};
    if (!CreatePipe(&read_pipe, &write_pipe, &attributes, 0)) return 127;
    SetHandleInformation(read_pipe, HANDLE_FLAG_INHERIT, 0);
    size_t command_size = strlen(backend) * 2 + 4;
    for (int index = 1; index < argc; ++index) command_size += strlen(argv[index]) * 2 + 4;
    char *command = calloc(command_size, 1);
    char *quoted = quote_windows(backend);
    if (!command || !quoted) return 127;
    strcat(command, quoted); free(quoted);
    for (int index = 1; index < argc; ++index) {
        quoted = quote_windows(argv[index]);
        strcat(command, " "); strcat(command, quoted); free(quoted);
    }
    STARTUPINFOA startup = {0};
    PROCESS_INFORMATION process = {0};
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    startup.hStdOutput = write_pipe;
    startup.hStdError = write_pipe;
    BOOL started = CreateProcessA(backend, command, NULL, NULL, TRUE, 0, NULL, NULL, &startup, &process);
    CloseHandle(write_pipe); free(command);
    if (!started) { CloseHandle(read_pipe); return 127; }
    char buffer[4096], record[RECORD_CAP]; size_t record_length = 0; DWORD count;
    while (ReadFile(read_pipe, buffer, sizeof(buffer), &count, NULL) && count)
        consume_output(state, log, buffer, count, record, &record_length);
    if (record_length) { record[record_length] = '\0'; parse_record(state, record); }
    CloseHandle(read_pipe);
    WaitForSingleObject(process.hProcess, INFINITE);
    DWORD exit_code = 1; GetExitCodeProcess(process.hProcess, &exit_code);
    CloseHandle(process.hThread); CloseHandle(process.hProcess);
    return (int)exit_code;
}
#else
static int run_child(const char *backend, int argc, char **argv, progress_state *state, FILE *log) {
    int pipefd[2];
    if (pipe(pipefd) != 0) return 127;
    pid_t child = fork();
    if (child < 0) return 127;
    if (child == 0) {
        close(pipefd[0]);
        dup2(pipefd[1], STDOUT_FILENO);
        dup2(pipefd[1], STDERR_FILENO);
        close(pipefd[1]);
        char **child_argv = calloc((size_t)argc + 1, sizeof(char *));
        child_argv[0] = (char *)backend;
        for (int index = 1; index < argc; ++index) child_argv[index] = argv[index];
        execv(backend, child_argv);
        _exit(127);
    }
    close(pipefd[1]);
    char buffer[4096], record[RECORD_CAP]; size_t record_length = 0; ssize_t count;
    while ((count = read(pipefd[0], buffer, sizeof(buffer))) > 0)
        consume_output(state, log, buffer, (size_t)count, record, &record_length);
    if (record_length) { record[record_length] = '\0'; parse_record(state, record); }
    close(pipefd[0]);
    int status = 0; waitpid(child, &status, 0);
    if (WIFEXITED(status)) return WEXITSTATUS(status);
    return WIFSIGNALED(status) ? 128 + WTERMSIG(status) : 1;
}
#endif

int main(int argc, char **argv) {
    char executable[PATH_CAP], directory[PATH_CAP], backend[PATH_CAP], log_path[PATH_CAP];
    if (executable_path(executable, sizeof(executable), argv[0]) != 0) return 127;
    strcpy(directory, executable); parent_dir(directory);
    if (path_join(backend, sizeof(backend), directory, MULTIWFN_BACKEND_BASENAME) != 0) return 127;
    const char *session_env = getenv("MULTIWFN_3DMOL_SESSION");
    progress_state state = {{0}, {0}, {0}, 0, 100};
    snprintf(state.session, sizeof(state.session), "%s", session_env && *session_env ? session_env : "multiwfn_3dmol_session");
    ensure_session_dir(state.session);
    set_environment("MULTIWFN_3DMOL_SESSION", state.session);
    set_environment("GFORTRAN_UNBUFFERED_ALL", "y");
    set_environment("FOR_DISABLE_BUFFERING", "1");
    char qt_launcher[PATH_CAP];
#ifdef _WIN32
    path_join(qt_launcher, sizeof(qt_launcher), directory, "resources\\tools\\multiwfn_qt_gui.exe");
#else
    path_join(qt_launcher, sizeof(qt_launcher), directory, "resources/tools/multiwfn_qt_gui");
#endif
    FILE *probe = fopen(qt_launcher, "rb");
    if (probe) { fclose(probe); set_environment("MULTIWFN_QT_LAUNCHER", qt_launcher); }
    if (path_join(log_path, sizeof(log_path), state.session, "runtime.log") != 0) return 127;
    FILE *log = fopen(log_path, "ab");
    int result = run_child(backend, argc, argv, &state, log);
    if (log) fclose(log);
    return result;
}
