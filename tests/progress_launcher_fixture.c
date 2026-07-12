#include <stdio.h>

#ifdef _WIN32
#include <wchar.h>
int wmain(int argc, wchar_t **argv) {
    if (argc != 2 || wcscmp(argv[1], L"argument with spaces") != 0) return 9;
#else
#include <string.h>
int main(int argc, char **argv) {
    if (argc != 2 || strcmp(argv[1], "argument with spaces") != 0) return 9;
#endif
    printf("MULTIWFN_GUI_PROGRESS fixture density 0 20\n");
    printf("Progress: [#####] 50.0 %%\r");
    printf("MULTIWFN_GUI_PROGRESS fixture complete 100 100\n");
    fflush(stdout);
    return 0;
}
