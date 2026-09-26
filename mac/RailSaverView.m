// RailSaver for macOS: a ScreenSaverView hosting the same WebGL clock
// (web/index.html) in a WKWebView. Files are served from the bundle through a
// custom URL scheme so ES modules load exactly as on Windows.

#import <ScreenSaver/ScreenSaver.h>
#import <WebKit/WebKit.h>

static NSString *const kScheme = @"railsaver";
static NSString *const kModuleName = @"com.axeasy.RailSaver";
static NSString *const kSettingsKey = @"settings";

// ---------------------------------------------------------------- bundle files

@interface RSBundleSchemeHandler : NSObject <WKURLSchemeHandler>
@property (nonatomic, strong) NSURL *root;
@end

@implementation RSBundleSchemeHandler

- (void)webView:(WKWebView *)webView startURLSchemeTask:(id<WKURLSchemeTask>)task {
    NSString *path = task.request.URL.path ?: @"/index.html";
    if (path.length <= 1) path = @"/index.html";
    NSURL *file = [[self.root URLByAppendingPathComponent:[path substringFromIndex:1]] URLByStandardizingPath];
    // Only files inside the web folder.
    if (![file.path hasPrefix:self.root.URLByStandardizingPath.path]) {
        [task didFailWithError:[NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorNoPermissionsToReadFile userInfo:nil]];
        return;
    }
    NSData *data = [NSData dataWithContentsOfURL:file];
    if (!data) {
        [task didFailWithError:[NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorFileDoesNotExist userInfo:nil]];
        return;
    }
    NSString *ext = file.pathExtension.lowercaseString;
    NSDictionary *types = @{ @"html": @"text/html", @"js": @"text/javascript", @"mjs": @"text/javascript",
                             @"css": @"text/css", @"json": @"application/json", @"png": @"image/png",
                             @"jpg": @"image/jpeg", @"svg": @"image/svg+xml", @"txt": @"text/plain" };
    NSString *mime = types[ext] ?: @"application/octet-stream";
    NSHTTPURLResponse *resp = [[NSHTTPURLResponse alloc] initWithURL:task.request.URL statusCode:200 HTTPVersion:@"HTTP/1.1"
        headerFields:@{ @"Content-Type": mime, @"Content-Length": [@(data.length) stringValue], @"Cache-Control": @"no-cache" }];
    [task didReceiveResponse:resp];
    [task didReceiveData:data];
    [task didFinish];
}

- (void)webView:(WKWebView *)webView stopURLSchemeTask:(id<WKURLSchemeTask>)task {}

@end

// A web view that never takes mouse or keyboard input: the screen saver engine
// must see every event so it can dismiss the saver.
@interface RSPassiveWebView : WKWebView
@end
@implementation RSPassiveWebView
- (NSView *)hitTest:(NSPoint)point { return nil; }
- (BOOL)acceptsFirstResponder { return NO; }
@end

// ---------------------------------------------------------------- the view

@interface RailSaverClockView : ScreenSaverView <WKScriptMessageHandler, WKUIDelegate>
@property (nonatomic, strong) WKWebView *webView;
@property (nonatomic, strong) NSWindow *sheet;
@property (nonatomic, strong) WKWebView *sheetWebView;
@property (nonatomic) BOOL loaded;
@end

@implementation RailSaverClockView

+ (ScreenSaverDefaults *)defaults { return [ScreenSaverDefaults defaultsForModuleWithName:kModuleName]; }

+ (NSString *)settingsJSON {
    NSString *json = [[self defaults] stringForKey:kSettingsKey];
    return json.length ? json : @"{}";
}

- (NSURL *)webRoot {
    return [[NSBundle bundleForClass:[self class]].resourceURL URLByAppendingPathComponent:@"web" isDirectory:YES];
}

- (WKWebViewConfiguration *)configurationWithHandler:(BOOL)handler {
    WKWebViewConfiguration *cfg = [[WKWebViewConfiguration alloc] init];
    RSBundleSchemeHandler *files = [RSBundleSchemeHandler new];
    files.root = [self webRoot];
    [cfg setURLSchemeHandler:files forURLScheme:kScheme];
    cfg.mediaTypesRequiringUserActionForPlayback = WKAudiovisualMediaTypeNone;
    NSString *inject = [NSString stringWithFormat:@"window.RAILSAVER_SETTINGS = %@;", [RailSaverClockView settingsJSON]];
    [cfg.userContentController addUserScript:[[WKUserScript alloc] initWithSource:inject
        injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:NO]];
    if (handler) [cfg.userContentController addScriptMessageHandler:self name:@"railsaver"];
    return cfg;
}

- (instancetype)initWithFrame:(NSRect)frame isPreview:(BOOL)isPreview {
    if ((self = [super initWithFrame:frame isPreview:isPreview])) {
        self.animationTimeInterval = 1.0;   // the page animates itself
        self.wantsLayer = YES;
        self.layer.backgroundColor = NSColor.blackColor.CGColor;

        _webView = [[RSPassiveWebView alloc] initWithFrame:self.bounds configuration:[self configurationWithHandler:NO]];
        _webView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        [_webView setValue:@NO forKey:@"drawsBackground"];
        [self addSubview:_webView];

        // macOS 14+: the legacy host keeps savers alive after they are dismissed.
        [[NSDistributedNotificationCenter defaultCenter] addObserver:self selector:@selector(willStop:)
            name:@"com.apple.screensaver.willstop" object:nil];
    }
    return self;
}

- (void)viewDidMoveToWindow {
    [super viewDidMoveToWindow];
    if (!self.window || self.loaded) return;
    self.loaded = YES;
    // Sound only from the main screen, never from the small preview.
    BOOL mainScreen = self.window.screen == NSScreen.screens.firstObject;
    BOOL audio = !self.isPreview && mainScreen;
    NSString *url = [NSString stringWithFormat:@"%@://app/index.html?mode=%@&audio=%d",
                     kScheme, self.isPreview ? @"preview" : @"saver", audio ? 1 : 0];
    [self.webView loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:url]]];
}

- (void)post:(NSString *)type {
    NSString *js = [NSString stringWithFormat:@"window.railsaver && window.railsaver.onMessage({type:'%@'})", type];
    [self.webView evaluateJavaScript:js completionHandler:nil];
}

- (void)startAnimation { [super startAnimation]; [self post:@"resume"]; }
- (void)stopAnimation { [super stopAnimation]; [self post:@"pause"]; }

- (void)willStop:(NSNotification *)n {
    [self post:@"pause"];
    if (!self.isPreview && [NSProcessInfo.processInfo.processName containsString:@"legacyScreenSaver"]) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{ exit(0); });
    }
}

- (void)animateOneFrame {}

// ---------------------------------------------------------------- settings sheet

- (BOOL)hasConfigureSheet { return YES; }

- (NSWindow *)configureSheet {
    NSRect r = NSMakeRect(0, 0, 1040, 700);
    self.sheet = [[NSWindow alloc] initWithContentRect:r styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskResizable
                                               backing:NSBackingStoreBuffered defer:NO];
    self.sheet.title = @"RailSaver";
    self.sheet.minSize = NSMakeSize(720, 520);
    self.sheetWebView = [[WKWebView alloc] initWithFrame:r configuration:[self configurationWithHandler:YES]];
    self.sheetWebView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    self.sheetWebView.UIDelegate = self;   // credit links open in the browser
    self.sheet.contentView = self.sheetWebView;
    NSString *version = [NSBundle bundleForClass:[self class]].infoDictionary[@"CFBundleShortVersionString"] ?: @"";
    NSString *url = [NSString stringWithFormat:@"%@://app/settings.html?version=%@", kScheme, version];
    [self.sheetWebView loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:url]]];
    return self.sheet;
}

- (void)userContentController:(WKUserContentController *)uc didReceiveScriptMessage:(WKScriptMessage *)message {
    if (![message.body isKindOfClass:[NSDictionary class]]) return;
    NSDictionary *msg = message.body;
    NSString *type = msg[@"type"];
    if ([type isEqualToString:@"save"] && [msg[@"settings"] isKindOfClass:[NSDictionary class]]) {
        NSData *data = [NSJSONSerialization dataWithJSONObject:msg[@"settings"] options:0 error:nil];
        if (data) {
            ScreenSaverDefaults *d = [RailSaverClockView defaults];
            [d setObject:[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] forKey:kSettingsKey];
            [d synchronize];
            // Show the change in the preview right away.
            NSString *js = [NSString stringWithFormat:@"window.railsaver && window.railsaver.onMessage({type:'settings',settings:%@})",
                            [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]];
            [self.webView evaluateJavaScript:js completionHandler:nil];
        }
    } else if ([type isEqualToString:@"close"]) {
        [self closeSheet];
    }
}

// Links with target="_blank" (credits, GitHub) open in the default browser.
- (WKWebView *)webView:(WKWebView *)webView createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration
   forNavigationAction:(WKNavigationAction *)action windowFeatures:(WKWindowFeatures *)features {
    NSURL *url = action.request.URL;
    if ([url.scheme isEqualToString:@"https"]) [[NSWorkspace sharedWorkspace] openURL:url];
    return nil;
}

- (void)closeSheet {
    NSWindow *sheet = self.sheet;
    if (!sheet) return;
    [self.sheetWebView.configuration.userContentController removeScriptMessageHandlerForName:@"railsaver"];
    if (sheet.sheetParent) [sheet.sheetParent endSheet:sheet];
    else [NSApp endSheet:sheet];
    [sheet orderOut:nil];
    self.sheet = nil;
    self.sheetWebView = nil;
}

- (void)dealloc {
    [[NSDistributedNotificationCenter defaultCenter] removeObserver:self];
}

@end
