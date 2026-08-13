CC ?= clang
UNAME := $(shell uname -s)
ifeq ($(UNAME),Darwin)
  LIB_EXT := dylib
else
  LIB_EXT := so
endif

BUILD_DIR := ../build
TARGET := $(BUILD_DIR)/libcrc_sdk.$(LIB_EXT)

.PHONY: all clean
all: $(TARGET)

$(TARGET): crc_sdk.c crc_sdk.h
	@mkdir -p $(BUILD_DIR)
	$(CC) -shared -fPIC -Wall -o $(TARGET) crc_sdk.c -lpthread

clean:
	rm -f $(TARGET)
