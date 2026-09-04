// Objective-C++: C++ containers inside an Objective-C class.
#import <Foundation/Foundation.h>
#include <vector>
#include <string>

@interface Scanner : NSObject
- (NSUInteger)count;
@end

@implementation Scanner {
    std::vector<std::string> paths_;
}
- (instancetype)init {
    if ((self = [super init])) { paths_ = {"a.md", "b.md"}; }
    return self;
}
- (NSUInteger)count { return paths_.size(); }  // 2
@end
