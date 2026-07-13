#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#endif

#include <stdlib.h>

#ifdef _WIN32
static wchar_t *multiwfn_command_to_wide(const char *command) {
    /* The supported MSYS2 UCRT64 GNU Fortran build exposes default CHARACTER
       paths as UTF-8 bytes.  Keep one explicit encoding contract and reject
       malformed input instead of guessing per command. */
    int length = MultiByteToWideChar(
        CP_UTF8, MB_ERR_INVALID_CHARS, command, -1, NULL, 0);
    if (length == 0) return NULL;

    wchar_t *wide = (wchar_t *)malloc((size_t)length * sizeof(wchar_t));
    if (wide == NULL) {
        SetLastError(ERROR_NOT_ENOUGH_MEMORY);
        return NULL;
    }
    if (MultiByteToWideChar(
            CP_UTF8, MB_ERR_INVALID_CHARS, command, -1, wide, length) == 0) {
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

    if (wide == NULL) {
        error_code = GetLastError();
        return error_code == 0 ? (int)ERROR_NO_UNICODE_TRANSLATION : (int)error_code;
    }
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
