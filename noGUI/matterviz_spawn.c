#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#endif

#include <stdlib.h>

#ifdef _WIN32
static wchar_t *multiwfn_command_to_wide(const char *command) {
    /* GNU Fortran default CHARACTER and get_environment_variable use the
       active Windows narrow-character runtime encoding.  Interpret the full
       command consistently as CP_ACP instead of guessing UTF-8 per string. */
    int length = MultiByteToWideChar(CP_ACP, 0, command, -1, NULL, 0);
    if (length == 0) return NULL;

    wchar_t *wide = (wchar_t *)malloc((size_t)length * sizeof(wchar_t));
    if (wide == NULL) return NULL;
    if (MultiByteToWideChar(CP_ACP, 0, command, -1, wide, length) == 0) {
        free(wide);
        return NULL;
    }
    return wide;
}
#endif

int multiwfn_spawn_async(const char *command) {
#ifdef _WIN32
    STARTUPINFOW startup = {0};
    PROCESS_INFORMATION process = {0};
    wchar_t *wide = multiwfn_command_to_wide(command);
    DWORD error_code;

    if (wide == NULL) return (int)ERROR_NOT_ENOUGH_MEMORY;
    startup.cb = sizeof(startup);
    if (!CreateProcessW(
            NULL, wide, NULL, NULL, FALSE, 0, NULL, NULL, &startup, &process)) {
        error_code = GetLastError();
        free(wide);
        return error_code == 0 ? 1 : (int)error_code;
    }

    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    free(wide);
    return 0;
#else
    (void)command;
    return -1;
#endif
}
