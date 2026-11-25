#include "bindings/bindings.h"

#import <UIKit/UIKit.h>
#import <UserNotifications/UserNotifications.h>
#import <objc/runtime.h>

// iPhone push notifications (mails, messages), sent by the Lamio server through Apple (APNs).
// Tauri owns the app delegate, so the two delegate methods that receive the device token are added
// to its class at launch. The token goes to Rust (lib.rs), which hands it to the Lamio page.

extern "C" void lamio_push_token_ready(const char *token);

static void lamioAddMethod(Class cls, SEL sel, id block, const char *types) {
	IMP imp = imp_implementationWithBlock(block);
	if (!class_addMethod(cls, sel, imp, types)) {
		// The delegate already has it: replace it (Tauri does not use these two today).
		method_setImplementation(class_getInstanceMethod(cls, sel), imp);
	}
}

static void lamioSetUpPush(void) {
	UIApplication *app = UIApplication.sharedApplication;
	Class cls = object_getClass(app.delegate);
	if (!cls) return;

	lamioAddMethod(cls, @selector(application:didRegisterForRemoteNotificationsWithDeviceToken:), ^(id _self, UIApplication *_app, NSData *deviceToken) {
		const unsigned char *bytes = (const unsigned char *)deviceToken.bytes;
		NSMutableString *hex = [NSMutableString stringWithCapacity:deviceToken.length * 2];
		for (NSUInteger i = 0; i < deviceToken.length; i++) [hex appendFormat:@"%02x", bytes[i]];
		lamio_push_token_ready(hex.UTF8String);
	}, "v@:@@");

	lamioAddMethod(cls, @selector(application:didFailToRegisterForRemoteNotificationsWithError:), ^(id _self, UIApplication *_app, NSError *error) {
		NSLog(@"Lamio : pas de notifications push (%@)", error.localizedDescription);
	}, "v@:@@");

	UNAuthorizationOptions options = UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge;
	[UNUserNotificationCenter.currentNotificationCenter requestAuthorizationWithOptions:options completionHandler:^(BOOL granted, NSError *error) {
		if (!granted) return;
		dispatch_async(dispatch_get_main_queue(), ^{
			[UIApplication.sharedApplication registerForRemoteNotifications];
		});
	}];
}

int main(int argc, char * argv[]) {
	@autoreleasepool {
		[NSNotificationCenter.defaultCenter addObserverForName:UIApplicationDidFinishLaunchingNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
			lamioSetUpPush();
		}];
	}
	ffi::start_app();
	return 0;
}
