# CMake: project, options, targets, generator expressions.
cmake_minimum_required(VERSION 3.20)
project(nfe_fixtures VERSION 0.1.0 LANGUAGES CXX)

option(NFE_STRICT "Treat warnings as errors" ON)
set(CMAKE_CXX_STANDARD 20)

add_executable(scanner src/main.cpp src/note.cpp)
target_include_directories(scanner PRIVATE ${CMAKE_SOURCE_DIR}/include)

if(NFE_STRICT)
  target_compile_options(scanner PRIVATE $<$<CXX_COMPILER_ID:GNU>:-Wall -Werror>)
endif()

message(STATUS "Configured ${PROJECT_NAME} ${PROJECT_VERSION}")
