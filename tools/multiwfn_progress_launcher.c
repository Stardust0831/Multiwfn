#include <ctype.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <shlobj.h>
#include <wchar.h>
#include <windows.h>
typedef wchar_t path_char;
#define PATH_LITERAL_INNER(value) L##value
#define PATH_LITERAL(value) PATH_LITERAL_INNER(value)
#define PATH_SEP L'\\'
#else
#include <signal.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif
typedef char path_char;
#define PATH_LITERAL(value) value
#define PATH_SEP '/'
#endif

#ifndef MULTIWFN_BACKEND_BASENAME
#define MULTIWFN_BACKEND_BASENAME "Multiwfn_QtGUI.backend"
#endif

#define PATH_CAP 4096
#define RECORD_CAP 8192

typedef struct {
    path_char session[PATH_CAP];
    char token[65];
    char phase[33];
    int phase_start;
    int phase_end;
} progress_state;

#ifdef _WIN32
static int path_join(path_char *out, size_t size, const path_char *left, const path_char *right) {
    return _snwprintf(out, size, L"%ls%lc%ls", left, PATH_SEP, right) >= 0 ? 0 : -1;
}

static void parent_dir(path_char *path) {
    path_char *slash = wcsrchr(path, L'/');
    path_char *backslash = wcsrchr(path, L'\\');
    if (!slash || (backslash && backslash > slash)) slash = backslash;
    if (slash) *slash = L'\0';
}

static int executable_path(path_char *out, size_t size, const path_char *unused) {
    (void)unused;
    DWORD length = GetModuleFileNameW(NULL, out, (DWORD)size);
    return length > 0 && length < size ? 0 : -1;
}

static int ensure_session_dir(const path_char *path) {
    int result = SHCreateDirectoryExW(NULL, path, NULL);
    return result == ERROR_SUCCESS || result == ERROR_ALREADY_EXISTS || result == ERROR_FILE_EXISTS ? 0 : -1;
}

static void set_environment(const path_char *name, const path_char *value) {
    _wputenv_s(name, value);
}

static FILE *path_fopen(const path_char *path, const path_char *mode) {
    return _wfopen(path, mode);
}
#else
static int path_join(path_char *out, size_t size, const path_char *left, const path_char *right) {
    int written = snprintf(out, size, "%s%c%s", left, PATH_SEP, right);
    return written >= 0 && (size_t)written < size ? 0 : -1;
}

static void parent_dir(path_char *path) {
    path_char *slash = strrchr(path, '/');
    if (slash) *slash = '\0';
}

static int executable_path(path_char *out, size_t size, const path_char *argv0) {
#ifdef __APPLE__
    uint32_t required = (uint32_t)size;
    char unresolved[PATH_CAP];
    if (_NSGetExecutablePath(unresolved, &required) != 0) return -1;
    return realpath(unresolved, out) ? 0 : -1;
#else
    (void)argv0;
    ssize_t length = readlink("/proc/self/exe", out, size - 1);
    if (length < 0 || (size_t)length >= size - 1) return -1;
    out[length] = '\0';
    return 0;
#endif
}

static int ensure_session_dir(const path_char *path) {
    char copy[PATH_CAP];
    if (snprintf(copy, sizeof(copy), "%s", path) >= (int)sizeof(copy)) return -1;
    for (char *cursor = copy + 1; *cursor; ++cursor) {
        if (*cursor != '/') continue;
        *cursor = '\0';
        if (mkdir(copy, 0700) != 0 && errno != EEXIST) return -1;
        *cursor = '/';
    }
    return mkdir(copy, 0700) == 0 || errno == EEXIST ? 0 : -1;
}

static void set_environment(const path_char *name, const path_char *value) {
    setenv(name, value, 1);
}

static FILE *path_fopen(const path_char *path, const path_char *mode) {
    return fopen(path, mode);
}
#endif

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
    path_char target[PATH_CAP], temporary[PATH_CAP], filename[128];
    if (!state->token[0]) return;
    if (phase_progress < 0) phase_progress = 0;
    if (phase_progress > 100) phase_progress = 100;
    int overall = state->phase_start
        + (state->phase_end - state->phase_start) * phase_progress / 100;
#ifdef _WIN32
    _snwprintf(filename, sizeof(filename) / sizeof(filename[0]), L"esp_progress_%hs.json", state->token);
#else
    snprintf(filename, sizeof(filename), "esp_progress_%s.json", state->token);
#endif
    if (path_join(target, PATH_CAP, state->session, filename) != 0) return;
#ifdef _WIN32
    if (wcslen(target) + 5 > PATH_CAP) return;
    wcscpy(temporary, target); wcscat(temporary, L".tmp");
#else
    if (strlen(target) + 5 > PATH_CAP) return;
    strcpy(temporary, target); strcat(temporary, ".tmp");
#endif
    FILE *file = path_fopen(temporary, PATH_LITERAL("wb"));
    if (!file) return;
    fprintf(file, "{\"phase\":\"%s\",\"phaseProgress\":%d,\"progress\":%d}",
            state->phase, phase_progress, overall);
    fclose(file);
#ifdef _WIN32
    MoveFileExW(temporary, target, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH);
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
    fwrite(data, 1, length, stdout); fflush(stdout);
    if (log) { fwrite(data, 1, length, log); fflush(log); }
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
static path_char *quote_windows(const path_char *value) {
    size_t length = wcslen(value), capacity = length * 2 + 3;
    path_char *quoted = malloc(capacity * sizeof(path_char));
    if (!quoted) return NULL;
    path_char *out = quoted; *out++ = L'"';
    size_t backslashes = 0;
    for (const path_char *cursor = value;; ++cursor) {
        if (*cursor == L'\\') {
            ++backslashes;
        } else {
            size_t count = backslashes * ((*cursor == L'"' || *cursor == L'\0') ? 2 : 1);
            while (count--) *out++ = L'\\';
            backslashes = 0;
            if (*cursor == L'"') *out++ = L'\\';
            if (*cursor == L'\0') break;
            *out++ = *cursor;
        }
    }
    *out++ = L'"'; *out = L'\0';
    return quoted;
}

static int run_child(const path_char *backend, int argc, path_char **argv,
                     progress_state *state, FILE *log) {
    HANDLE read_pipe = NULL, write_pipe = NULL, job = NULL;
    SECURITY_ATTRIBUTES attributes = {sizeof(attributes), NULL, TRUE};
    if (!CreatePipe(&read_pipe, &write_pipe, &attributes, 0)) return 127;
    SetHandleInformation(read_pipe, HANDLE_FLAG_INHERIT, 0);
    size_t command_size = wcslen(backend) * 2 + 4;
    for (int index = 1; index < argc; ++index) command_size += wcslen(argv[index]) * 2 + 4;
    path_char *command = calloc(command_size, sizeof(path_char));
    path_char *quoted = quote_windows(backend);
    if (!command || !quoted) { CloseHandle(read_pipe); CloseHandle(write_pipe); return 127; }
    wcscat(command, quoted); free(quoted);
    for (int index = 1; index < argc; ++index) {
        quoted = quote_windows(argv[index]);
        if (!quoted) { free(command); CloseHandle(read_pipe); CloseHandle(write_pipe); return 127; }
        wcscat(command, L" "); wcscat(command, quoted); free(quoted);
    }
    STARTUPINFOW startup = {0}; PROCESS_INFORMATION process = {0};
    startup.cb = sizeof(startup); startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    startup.hStdOutput = write_pipe; startup.hStdError = write_pipe;
    BOOL started = CreateProcessW(backend, command, NULL, NULL, TRUE, 0, NULL, NULL, &startup, &process);
    CloseHandle(write_pipe); free(command);
    if (!started) { CloseHandle(read_pipe); return 127; }
    job = CreateJobObjectW(NULL, NULL);
    if (job) {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {0};
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))
            || !AssignProcessToJobObject(job, process.hProcess)) {
            CloseHandle(job); job = NULL;
        }
    }
    char buffer[4096], record[RECORD_CAP]; size_t record_length = 0; DWORD count;
    while (ReadFile(read_pipe, buffer, sizeof(buffer), &count, NULL) && count)
        consume_output(state, log, buffer, count, record, &record_length);
    if (record_length) { record[record_length] = '\0'; parse_record(state, record); }
    CloseHandle(read_pipe); WaitForSingleObject(process.hProcess, INFINITE);
    DWORD exit_code = 1; GetExitCodeProcess(process.hProcess, &exit_code);
    CloseHandle(process.hThread); CloseHandle(process.hProcess); if (job) CloseHandle(job);
    return (int)exit_code;
}
#else
static volatile sig_atomic_t child_group = -1;

static void forward_signal(int signal_number) {
    if (child_group > 0) kill(-(pid_t)child_group, signal_number);
}

static void install_signal_handlers(void) {
    struct sigaction action;
    const int signals[] = {SIGINT, SIGTERM, SIGHUP, SIGQUIT};
    memset(&action, 0, sizeof(action));
    action.sa_handler = forward_signal;
    sigemptyset(&action.sa_mask);
    for (size_t index = 0; index < 4; ++index) {
        sigaction(signals[index], &action, NULL);
    }
}

static void reset_child_signals(void) {
    const int signals[] = {SIGINT, SIGTERM, SIGHUP, SIGQUIT};
    struct sigaction action;
    memset(&action, 0, sizeof(action));
    action.sa_handler = SIG_DFL;
    sigemptyset(&action.sa_mask);
    for (size_t index = 0; index < 4; ++index) sigaction(signals[index], &action, NULL);
}

static int run_child(const path_char *backend, int argc, path_char **argv,
                     progress_state *state, FILE *log) {
    int pipefd[2];
    if (pipe(pipefd) != 0) return 127;
    install_signal_handlers();
    pid_t child = fork();
    if (child < 0) { close(pipefd[0]); close(pipefd[1]); return 127; }
    if (child == 0) {
        setpgid(0, 0);
        reset_child_signals();
        close(pipefd[0]); dup2(pipefd[1], STDOUT_FILENO); dup2(pipefd[1], STDERR_FILENO); close(pipefd[1]);
        char **child_argv = calloc((size_t)argc + 1, sizeof(char *));
        child_argv[0] = (char *)backend;
        for (int index = 1; index < argc; ++index) child_argv[index] = argv[index];
        execv(backend, child_argv); _exit(127);
    }
    child_group = child; setpgid(child, child); close(pipefd[1]);
    char buffer[4096], record[RECORD_CAP]; size_t record_length = 0;
    for (;;) {
        ssize_t count = read(pipefd[0], buffer, sizeof(buffer));
        if (count > 0) { consume_output(state, log, buffer, (size_t)count, record, &record_length); continue; }
        if (count < 0 && errno == EINTR) continue;
        break;
    }
    if (record_length) { record[record_length] = '\0'; parse_record(state, record); }
    close(pipefd[0]);
    int status = 0;
    while (waitpid(child, &status, 0) < 0) if (errno != EINTR) return 1;
    child_group = -1;
    if (WIFEXITED(status)) return WEXITSTATUS(status);
    return WIFSIGNALED(status) ? 128 + WTERMSIG(status) : 1;
}
#endif

#ifdef _WIN32
int wmain(int argc, wchar_t **argv) {
#else
int main(int argc, char **argv) {
#endif
    path_char executable[PATH_CAP], directory[PATH_CAP], backend[PATH_CAP], log_path[PATH_CAP];
    if (executable_path(executable, PATH_CAP, argv[0]) != 0) return 127;
    memcpy(directory, executable, sizeof(executable)); parent_dir(directory);
    if (path_join(backend, PATH_CAP, directory, PATH_LITERAL(MULTIWFN_BACKEND_BASENAME)) != 0) return 127;
    progress_state state = {{0}, {0}, {0}, 0, 100};
#ifdef _WIN32
    const wchar_t *session_env = _wgetenv(L"MULTIWFN_3DMOL_SESSION");
    _snwprintf(state.session, PATH_CAP, L"%ls", session_env && *session_env ? session_env : L"multiwfn_3dmol_session");
#else
    const char *session_env = getenv("MULTIWFN_3DMOL_SESSION");
    snprintf(state.session, PATH_CAP, "%s", session_env && *session_env ? session_env : "multiwfn_3dmol_session");
#endif
    if (ensure_session_dir(state.session) != 0)
        fprintf(stderr, "Warning: could not create the Multiwfn GUI session directory.\n");
    set_environment(PATH_LITERAL("MULTIWFN_3DMOL_SESSION"), state.session);
    set_environment(PATH_LITERAL("GFORTRAN_UNBUFFERED_ALL"), PATH_LITERAL("y"));
    set_environment(PATH_LITERAL("FOR_DISABLE_BUFFERING"), PATH_LITERAL("1"));
    path_char qt_launcher[PATH_CAP];
#ifdef _WIN32
    path_join(qt_launcher, PATH_CAP, directory, L"resources\\tools\\multiwfn_qt_gui.exe");
#else
    path_join(qt_launcher, PATH_CAP, directory, "resources/tools/multiwfn_qt_gui");
#endif
    FILE *probe = path_fopen(qt_launcher, PATH_LITERAL("rb"));
    if (probe) { fclose(probe); set_environment(PATH_LITERAL("MULTIWFN_QT_LAUNCHER"), qt_launcher); }
    if (path_join(log_path, PATH_CAP, state.session, PATH_LITERAL("runtime.log")) != 0) return 127;
    FILE *log = path_fopen(log_path, PATH_LITERAL("ab"));
    if (!log) fprintf(stderr, "Warning: could not open the Multiwfn GUI runtime log.\n");
    int result = run_child(backend, argc, argv, &state, log);
    if (log) fclose(log);
    return result;
}
