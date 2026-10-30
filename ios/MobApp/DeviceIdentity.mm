#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>

@interface DeviceIdentity : NSObject <RCTBridgeModule>
@end

@implementation DeviceIdentity
RCT_EXPORT_MODULE();
+ (BOOL)requiresMainQueueSetup { return NO; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
RCT_EXPORT_METHOD(getIdentifier:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  NSString *identifier = UIDevice.currentDevice.identifierForVendor.UUIDString;
  if (identifier.length == 0) {
    reject(@"identifier_unavailable", @"Unlock the device and try again.", nil);
    return;
  }
  resolve(identifier);
}
@end
