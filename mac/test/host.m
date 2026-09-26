// CI smoke test: hosts RailSaver.saver's view in a window, like the screen
// saver engine does, waits, then saves a snapshot and the page state.
// Usage: host <path/to/RailSaver.saver> <out.png>
#import <Cocoa/Cocoa.h>
#import <ScreenSaver/ScreenSaver.h>
#import <WebKit/WebKit.h>

static WKWebView *findWebView(NSView *v) {
    if ([v isKindOfClass:[WKWebView class]]) return (WKWebView *)v;
    for (NSView *s in v.subviews) { WKWebView *w = findWebView(s); if (w) return w; }
    return nil;
}

int main(int argc, const char **argv) {
    @autoreleasepool {
        if (argc < 3) return 2;
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
        NSBundle *bundle = [NSBundle bundleWithPath:@(argv[1])];
        if (![bundle load]) { NSLog(@"host: cannot load bundle"); return 1; }
        Class cls = [bundle principalClass];
        NSRect r = NSMakeRect(0, 0, 1280, 720);
        NSWindow *win = [[NSWindow alloc] initWithContentRect:r styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
        ScreenSaverView *view = [[cls alloc] initWithFrame:r isPreview:NO];
        win.contentView = view;
        [win makeKeyAndOrderFront:nil];
        [NSApp activateIgnoringOtherApps:YES];
        [view startAnimation];
        NSString *out = @(argv[2]);
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(12 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            WKWebView *web = findWebView(view);
            if (!web) { NSLog(@"host: no web view"); exit(1); }
            [web evaluateJavaScript:@"JSON.stringify({ready: document.documentElement.dataset.ready || null, error: (document.getElementById('error')||{}).textContent || null, webgl: !!document.createElement('canvas').getContext('webgl2'), ua: navigator.userAgent})"
                  completionHandler:^(id result, NSError *err) {
                NSLog(@"host: page state %@ %@", result, err ?: @"");
                [web takeSnapshotWithConfiguration:nil completionHandler:^(NSImage *img, NSError *e) {
                    if (!img) { NSLog(@"host: snapshot failed %@", e); exit(1); }
                    NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithData:img.TIFFRepresentation];
                    [[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:out atomically:YES];
                    NSLog(@"host: wrote %@", out);
                    exit(0);
                }];
            }];
        });
        [NSApp run];
    }
    return 0;
}
