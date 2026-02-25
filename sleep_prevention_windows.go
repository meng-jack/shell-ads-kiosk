//go:build windows
// +build windows

package main

import (
	"syscall"
)

var (
	kernel32                    = syscall.NewLazyDLL("kernel32.dll")
	procSetThreadExecutionState = kernel32.NewProc("SetThreadExecutionState")
)

// ExecutionState flags for SetThreadExecutionState
const (
	ES_SYSTEM_REQUIRED  = 0x00000001
	ES_DISPLAY_REQUIRED = 0x00000002
	ES_USER_PRESENT     = 0x00000004
	ES_CONTINUOUS       = 0x80000000
)

// PreventWindowsSleep prevents the Windows system from sleeping by setting
// the thread execution state to keep the system active.
func PreventWindowsSleep() {
	// ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
	// This keeps both the system and display awake
	state := uintptr(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED)
	procSetThreadExecutionState.Call(state)
}

// AllowWindowsSleep allows the Windows system to sleep normally
func AllowWindowsSleep() {
	// ES_CONTINUOUS with no other flags resets to normal sleep behavior
	state := uintptr(ES_CONTINUOUS)
	procSetThreadExecutionState.Call(state)
}
