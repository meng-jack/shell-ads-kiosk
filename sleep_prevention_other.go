//go:build !windows
// +build !windows

package main

// PreventWindowsSleep is a no-op on non-Windows platforms
func PreventWindowsSleep() {
	// Not needed on non-Windows systems
}

// AllowWindowsSleep is a no-op on non-Windows platforms
func AllowWindowsSleep() {
	// Not needed on non-Windows systems
}
