#ifdef _WIN32
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0600
#endif
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

static HANDLE multiwfn_inheritable_std_handle(DWORD std_id, DWORD null_access) {
    HANDLE source = GetStdHandle(std_id);
    HANDLE duplicate = NULL;

    if (source != NULL && source != INVALID_HANDLE_VALUE &&
        DuplicateHandle(
            GetCurrentProcess(), source, GetCurrentProcess(), &duplicate,
            0, TRUE, DUPLICATE_SAME_ACCESS)) {
        return duplicate;
    }

    SECURITY_ATTRIBUTES security = {
        sizeof(SECURITY_ATTRIBUTES), NULL, TRUE
    };
    return CreateFileW(
        L"NUL", null_access, FILE_SHARE_READ | FILE_SHARE_WRITE,
        &security, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
}

static void multiwfn_close_handles(HANDLE *handles, size_t count) {
    size_t index;
    for (index = 0; index < count; ++index) {
        if (handles[index] != NULL && handles[index] != INVALID_HANDLE_VALUE) {
            CloseHandle(handles[index]);
        }
    }
}
#endif

int multiwfn_spawn_async(const char *command) {
#ifdef _WIN32
    STARTUPINFOEXW startup = {0};
    PROCESS_INFORMATION process = {0};
    HANDLE inherited_handles[3] = {NULL, NULL, NULL};
    SIZE_T attribute_size = 0;
    LPPROC_THREAD_ATTRIBUTE_LIST attributes = NULL;
    wchar_t *wide = multiwfn_command_to_wide(command);
    DWORD error_code;

    if (wide == NULL) {
        error_code = GetLastError();
        return error_code == 0 ? (int)ERROR_NO_UNICODE_TRANSLATION : (int)error_code;
    }
    inherited_handles[0] = multiwfn_inheritable_std_handle(
        STD_INPUT_HANDLE, GENERIC_READ);
    inherited_handles[1] = multiwfn_inheritable_std_handle(
        STD_OUTPUT_HANDLE, GENERIC_WRITE);
    inherited_handles[2] = multiwfn_inheritable_std_handle(
        STD_ERROR_HANDLE, GENERIC_WRITE);
    if (inherited_handles[0] == INVALID_HANDLE_VALUE ||
        inherited_handles[1] == INVALID_HANDLE_VALUE ||
        inherited_handles[2] == INVALID_HANDLE_VALUE) {
        error_code = GetLastError();
        multiwfn_close_handles(inherited_handles, 3);
        free(wide);
        return error_code == 0 ? 1 : (int)error_code;
    }

    InitializeProcThreadAttributeList(NULL, 1, 0, &attribute_size);
    attributes = (LPPROC_THREAD_ATTRIBUTE_LIST)malloc(attribute_size);
    if (attributes == NULL) {
        multiwfn_close_handles(inherited_handles, 3);
        free(wide);
        return (int)ERROR_NOT_ENOUGH_MEMORY;
    }
    if (!InitializeProcThreadAttributeList(attributes, 1, 0, &attribute_size)) {
        error_code = GetLastError();
        free(attributes);
        multiwfn_close_handles(inherited_handles, 3);
        free(wide);
        return error_code == 0 ? 1 : (int)error_code;
    }
    if (!UpdateProcThreadAttribute(
            attributes, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
            inherited_handles, sizeof(inherited_handles), NULL, NULL)) {
        error_code = GetLastError();
        DeleteProcThreadAttributeList(attributes);
        free(attributes);
        multiwfn_close_handles(inherited_handles, 3);
        free(wide);
        return error_code == 0 ? 1 : (int)error_code;
    }

    startup.StartupInfo.cb = sizeof(startup);
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = inherited_handles[0];
    startup.StartupInfo.hStdOutput = inherited_handles[1];
    startup.StartupInfo.hStdError = inherited_handles[2];
    startup.lpAttributeList = attributes;
    if (!CreateProcessW(
            NULL, wide, NULL, NULL, TRUE, EXTENDED_STARTUPINFO_PRESENT,
            NULL, NULL, &startup.StartupInfo, &process)) {
        error_code = GetLastError();
        DeleteProcThreadAttributeList(attributes);
        free(attributes);
        multiwfn_close_handles(inherited_handles, 3);
        free(wide);
        return error_code == 0 ? 1 : (int)error_code;
    }

    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    DeleteProcThreadAttributeList(attributes);
    free(attributes);
    multiwfn_close_handles(inherited_handles, 3);
    free(wide);
    return 0;
#else
    (void)command;
    return -1;
#endif
}
