/* Independent BaneWfn GUI entry. */
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#include <windows.h>
#include <wchar.h>
#include <stdlib.h>
int WINAPI wWinMain(HINSTANCE instance,HINSTANCE previous,LPWSTR args,int show) {
    (void)instance;(void)previous;(void)show;
    wchar_t executable[32768],host[32768];
    DWORD n=GetModuleFileNameW(NULL,executable,32768);
    if(!n || n>=32768) return 2;
    wchar_t *slash=wcsrchr(executable,L'\\');if(!slash) return 2;*slash=0;
    if(swprintf(host,32768,L"%ls\\resources\\tools\\matterviz-desktop.exe",executable)<0) return 2;
    size_t size=wcslen(host)+wcslen(args)+32;
    wchar_t *command=calloc(size,sizeof(wchar_t));if(!command) return 2;
    swprintf(command,size,L"\"%ls\" --workbench %ls",host,args);
    STARTUPINFOW startup={0};startup.cb=sizeof(startup);
    PROCESS_INFORMATION process={0};
    BOOL ok=CreateProcessW(host,command,NULL,NULL,FALSE,CREATE_NO_WINDOW,NULL,NULL,&startup,&process);
    free(command);
    if(!ok) { MessageBoxW(NULL,L"Cannot start MatterViz. Keep this launcher beside the resources folder.",L"Multiwfn",MB_OK|MB_ICONERROR);return 2; }
    CloseHandle(process.hThread);CloseHandle(process.hProcess);return 0;
}
