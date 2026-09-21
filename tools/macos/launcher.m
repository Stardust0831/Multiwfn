#import <Cocoa/Cocoa.h>
#import <sys/stat.h>
#import <unistd.h>

@interface MultiwfnAppDelegate : NSObject <NSApplicationDelegate>
@property (nonatomic, assign) BOOL fileOpened;
@property (nonatomic, strong) NSString *pendingFile;
@end

@implementation MultiwfnAppDelegate

- (void)application:(NSApplication *)sender openFiles:(NSArray<NSString *> *)filenames {
    if (filenames.count > 0) {
        self.fileOpened = YES;
        self.pendingFile = filenames.firstObject;
        [self launchWithFile:self.pendingFile];
    }
}

- (BOOL)application:(NSApplication *)sender openFile:(NSString *)filename {
    self.fileOpened = YES;
    self.pendingFile = filename;
    [self launchWithFile:self.pendingFile];
    return YES;
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    // Allow a short run loop turn (100ms) for LaunchServices to deliver any initial openFiles Apple Event
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.10 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        if (!self.fileOpened) {
            [self promptOpenFileAndLaunch];
        }
    });
}

- (void)promptOpenFileAndLaunch {
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    [panel setTitle:@"Multiwfn - Select Input File"];
    [panel setMessage:@"Select a quantum chemistry file for Multiwfn:"];
    [panel setCanChooseFiles:YES];
    [panel setCanChooseDirectories:NO];
    [panel setAllowsMultipleSelection:NO];

    [NSApp activateIgnoringOtherApps:YES];

    if ([panel runModal] == NSModalResponseOK) {
        NSString *path = [[panel URL] path];
        if (path && [[NSFileManager defaultManager] fileExistsAtPath:path]) {
            [self launchWithFile:path];
            return;
        }
    }
    // User cancelled file selection dialog
    [NSApp terminate:nil];
}

- (void)launchWithFile:(NSString *)filePath {
    NSBundle *bundle = [NSBundle mainBundle];
    NSString *macosDir = [bundle executablePath].stringByDeletingLastPathComponent;
    NSString *runnerScript = [macosDir stringByAppendingPathComponent:@"multiwfn_macos_launcher.sh"];

    NSTask *task = [[NSTask alloc] init];
    [task setExecutableURL:[NSURL fileURLWithPath:@"/bin/bash"]];

    NSMutableArray<NSString *> *arguments = [NSMutableArray array];
    [arguments addObject:runnerScript];
    if (filePath && filePath.length > 0) {
        [arguments addObject:filePath];
    }
    [task setArguments:arguments];

    NSMutableDictionary *env = [[[NSProcessInfo processInfo] environment] mutableCopy];
    env[@"MULTIWFN_DIRECT_GUI"] = @"1";
    [task setEnvironment:env];

    NSError *error = nil;
    [task launchAndReturnError:&error];
    if (error) {
        NSLog(@"Multiwfn: Failed to launch backend task: %@", error);
    }

    // Once child backend task is launched, terminate the Cocoa launcher wrapper
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.3 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        [NSApp terminate:nil];
    });
}

@end

int main(int argc, const char * argv[]) {
    // If invoked from an interactive terminal (stdin/stdout is a TTY),
    // from an SSH or CI environment, or if arguments are explicitly passed on CLI:
    BOOL isTerminal = isatty(STDIN_FILENO) || isatty(STDOUT_FILENO);
    BOOL isNonGuiEnv = getenv("SSH_CONNECTION") != NULL || getenv("SSH_CLIENT") != NULL || getenv("CI") != NULL;
    BOOL hasCliFile = NO;
    for (int i = 1; i < argc; i++) {
        if (strncmp(argv[i], "-psn", 4) != 0 && argv[i][0] != '\0') {
            hasCliFile = YES;
            break;
        }
    }

    if (isTerminal || isNonGuiEnv || hasCliFile) {
        // Forward directly to runner script
        NSString *execPath = [NSString stringWithUTF8String:argv[0]];
        NSString *macosDir = [execPath stringByDeletingLastPathComponent];
        NSString *runner = [macosDir stringByAppendingPathComponent:@"multiwfn_macos_launcher.sh"];
        if (access(runner.UTF8String, X_OK) == 0) {
            const char **new_argv = malloc((argc + 2) * sizeof(char *));
            new_argv[0] = "/bin/bash";
            new_argv[1] = runner.UTF8String;
            for (int i = 1; i < argc; i++) {
                new_argv[i + 1] = argv[i];
            }
            new_argv[argc + 1] = NULL;
            execv("/bin/bash", (char * const *)new_argv);
        }
    }

    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        MultiwfnAppDelegate *delegate = [[MultiwfnAppDelegate alloc] init];
        [app setDelegate:delegate];
        [app run];
    }
    return 0;
}
