// Objective-C: interface, implementation, message sends, blocks.
#import <Foundation/Foundation.h>

@interface Note : NSObject
@property (nonatomic, copy) NSString *path;
@property (nonatomic, strong) NSArray<NSString *> *tags;
- (NSUInteger)size;
@end

@implementation Note
- (NSUInteger)size {
    NSData *data = [NSData dataWithContentsOfFile:self.path];
    return data ? data.length : 0;
}
@end

int main(void) {
    @autoreleasepool {
        Note *n = [Note new];
        n.path = @"a.md";
        NSLog(@"%@: %lu bytes", n.path, (unsigned long)[n size]);
    }
    return 0;
}
