/* Independent BaneWfn GUI entry. */
#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
    char executable[PATH_MAX];
    ssize_t length = readlink("/proc/self/exe", executable, sizeof(executable) - 1);
    if (length < 0 || (size_t)length >= sizeof(executable) - 1) {
        fprintf(stderr, "Multiwfn: cannot locate application directory\n");
        return 1;
    }
    executable[length] = '\0';
    char *slash = strrchr(executable, '/');
    if (!slash) return 1;
    *slash = '\0';
    const char suffix[] = "/run-workflows-gui";
    char *script = malloc(strlen(executable) + sizeof(suffix));
    char **arguments = calloc((size_t)argc + 2, sizeof(*arguments));
    if (!script || !arguments) {
        fprintf(stderr, "Multiwfn: out of memory\n");
        free(script);
        free(arguments);
        return 1;
    }
    strcpy(script, executable);
    strcat(script, suffix);
    arguments[0] = script;
    for (int i = 1; i < argc; ++i) arguments[i] = argv[i];
    execv(script, arguments);
    fprintf(stderr, "Multiwfn: cannot start %s: %s\n", script, strerror(errno));
    free(arguments);
    free(script);
    return 1;
}
