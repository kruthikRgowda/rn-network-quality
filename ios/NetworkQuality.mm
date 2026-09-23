#import "NetworkQuality.h"

#if __has_include(<rn_network_quality/rn_network_quality-Swift.h>)
#import <rn_network_quality/rn_network_quality-Swift.h>
#else
#import "rn_network_quality-Swift.h"
#endif

@interface NetworkQuality ()
@property(nonatomic, strong) NetworkQualityImpl *impl;
@end

@implementation NetworkQuality

- (instancetype)init
{
  self = [super init];
  if (self) {
    _impl = [NetworkQualityImpl new];
    __weak NetworkQuality *weakSelf = self;
    _impl.onChange = ^(NSDictionary<NSString *, id> *snapshot) {
      NetworkQuality *strongSelf = weakSelf;
      if (strongSelf != nil) {
        [strongSelf emitOnNetworkStateChange:snapshot];
      }
    };
  }
  return self;
}

+ (NSString *)moduleName
{
  return @"NetworkQuality";
}

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (void)getCurrentState:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject
{
  [_impl getCurrentStateWithResolve:resolve reject:reject];
}

- (void)startMonitoring:(JS::NativeNetworkQuality::NativeMonitorOptions &)options
{
  [_impl startMonitoringWithThrottleMs:@(options.throttleMs())
           bandwidthChangeThresholdPct:@(options.bandwidthChangeThresholdPct())];
}

- (void)stopMonitoring
{
  [_impl stopMonitoring];
}

- (void)probe:(JS::NativeNetworkQuality::NativeProbeOptions &)options
      resolve:(RCTPromiseResolveBlock)resolve
       reject:(RCTPromiseRejectBlock)reject
{
  [_impl probeWithLatencyUrl:options.latencyUrl()
                 downloadUrl:options.downloadUrl()
              latencySamples:@(options.latencySamples())
                   timeoutMs:@(options.timeoutMs())
       downloadMaxDurationMs:@(options.downloadMaxDurationMs())
            downloadMaxBytes:@(options.downloadMaxBytes())
                     resolve:resolve
                      reject:reject];
}

- (void)invalidate
{
  [_impl invalidate];
}

- (void)dealloc
{
  [_impl invalidate];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeNetworkQualitySpecJSI>(params);
}

@end
