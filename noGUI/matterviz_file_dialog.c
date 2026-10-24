/* Optional GTK chooser in its own process: never share GTK thread ownership
 * with the Tauri host. Multiple UTF-8 paths are NUL-separated; a single path
 * is written without a delimiter. */
#include <gtk/gtk.h>
#include <stdio.h>
#include <string.h>
int main(int argc,char **argv) {
    gboolean viewer=argc==4 && strcmp(argv[1],"save-viewer")==0;
    if ((argc!=2 && !viewer) || !gtk_init_check(NULL,NULL)) return 2;
    gboolean folder=strcmp(argv[1],"library")==0 || strcmp(argv[1],"results")==0;
    gboolean script=strcmp(argv[1],"script")==0;
    gboolean save=viewer || strcmp(argv[1],"save-script")==0;
    gboolean multiple=strcmp(argv[1],"wavefunctions")==0;
    const char *title=viewer ? "Save viewer export" : save ? "Save BaneWfn script" : folder ? "Choose a folder" : script ? "Open workflow script" : "Choose startup file";
    GtkWidget *dialog=gtk_file_chooser_dialog_new(title,NULL,
        save ? GTK_FILE_CHOOSER_ACTION_SAVE : folder ? GTK_FILE_CHOOSER_ACTION_SELECT_FOLDER : GTK_FILE_CHOOSER_ACTION_OPEN,
        "Cancel",GTK_RESPONSE_CANCEL,save ? "Save" : "Select",GTK_RESPONSE_ACCEPT,NULL);
    if (save) {
        gtk_file_chooser_set_current_name(GTK_FILE_CHOOSER(dialog),viewer ? argv[2] : "workflow.bwc");
        gtk_file_chooser_set_do_overwrite_confirmation(GTK_FILE_CHOOSER(dialog),TRUE);
    }
    if (multiple) gtk_file_chooser_set_select_multiple(GTK_FILE_CHOOSER(dialog),TRUE);
    if (viewer) {
        GtkFileFilter *filter=gtk_file_filter_new();
        char *pattern=g_strdup_printf("*.%s",argv[3]);
        gtk_file_filter_set_name(filter,pattern);
        gtk_file_filter_add_pattern(filter,pattern);
        gtk_file_chooser_add_filter(GTK_FILE_CHOOSER(dialog),filter);
        g_free(pattern);
    } else if (script || save) {
        GtkFileFilter *filter=gtk_file_filter_new();
        gtk_file_filter_set_name(filter,save ? "BaneWfn script (*.bwc)" : "BaneWfn scripts (*.bw, *.bwc)");
        if (!save) gtk_file_filter_add_pattern(filter,"*.bw");
        gtk_file_filter_add_pattern(filter,"*.bwc");
        gtk_file_chooser_add_filter(GTK_FILE_CHOOSER(dialog),filter);
    }
    int result=1;
    if (gtk_dialog_run(GTK_DIALOG(dialog))==GTK_RESPONSE_ACCEPT) {
        if (multiple) {
            GSList *paths=gtk_file_chooser_get_filenames(GTK_FILE_CHOOSER(dialog));
            for (GSList *node=paths;node;node=node->next) {fputs((char*)node->data,stdout);fputc(0,stdout);}
            if (paths) result=0;
            g_slist_free_full(paths,g_free);
        } else {
            char *path=gtk_file_chooser_get_filename(GTK_FILE_CHOOSER(dialog));
            if (path) { fputs(path,stdout); g_free(path); result=0; }
        }
    }
    gtk_widget_destroy(dialog);
    while (gtk_events_pending()) gtk_main_iteration();
    return result;
}
