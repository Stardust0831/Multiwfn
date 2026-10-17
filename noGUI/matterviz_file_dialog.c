/* Optional GTK chooser in its own process: never share GTK thread ownership
 * with the Tauri host. stdout is the selected UTF-8 path, without a delimiter. */
#include <gtk/gtk.h>
#include <stdio.h>
#include <string.h>
int main(int argc,char **argv) {
    if (argc!=2 || !gtk_init_check(NULL,NULL)) return 2;
    gboolean folder=strcmp(argv[1],"library")==0 || strcmp(argv[1],"results")==0;
    gboolean script=strcmp(argv[1],"script")==0;
    const char *title=folder ? "Choose a folder" : script ? "Open workflow script" : "Choose startup file";
    GtkWidget *dialog=gtk_file_chooser_dialog_new(title,NULL,
        folder ? GTK_FILE_CHOOSER_ACTION_SELECT_FOLDER : GTK_FILE_CHOOSER_ACTION_OPEN,
        "Cancel",GTK_RESPONSE_CANCEL,"Select",GTK_RESPONSE_ACCEPT,NULL);
    if (script) {
        GtkFileFilter *filter=gtk_file_filter_new();
        gtk_file_filter_set_name(filter,"BaneWfn scripts (*.bw, *.bwc)");
        gtk_file_filter_add_pattern(filter,"*.bw");
        gtk_file_filter_add_pattern(filter,"*.bwc");
        gtk_file_chooser_add_filter(GTK_FILE_CHOOSER(dialog),filter);
    }
    int result=1;
    if (gtk_dialog_run(GTK_DIALOG(dialog))==GTK_RESPONSE_ACCEPT) {
        char *path=gtk_file_chooser_get_filename(GTK_FILE_CHOOSER(dialog));
        if (path) { fputs(path,stdout); g_free(path); result=0; }
    }
    gtk_widget_destroy(dialog);
    while (gtk_events_pending()) gtk_main_iteration();
    return result;
}
