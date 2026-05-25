package fileutil

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAtomicWriteFile(t *testing.T) {
	tmpDir := t.TempDir()
	fileName := filepath.Join(tmpDir, "settings.json")

	err := AtomicWriteFile(fileName, []byte(`{"key":"value"}`), 0644)
	if err != nil {
		t.Fatalf("AtomicWriteFile failed: %v", err)
	}

	data, err := os.ReadFile(fileName)
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	if string(data) != `{"key":"value"}` {
		t.Fatalf("unexpected file contents: %q", string(data))
	}
	if _, err := os.Stat(fileName + TempFileSuffix); !os.IsNotExist(err) {
		t.Fatalf("temporary file should not exist, stat err: %v", err)
	}
}

func TestAtomicWriteFileRenameErrorCleansTempFile(t *testing.T) {
	tmpDir := t.TempDir()
	fileName := filepath.Join(tmpDir, "settings.json")

	if err := os.Mkdir(fileName, 0755); err != nil {
		t.Fatalf("Mkdir failed: %v", err)
	}

	err := AtomicWriteFile(fileName, []byte(`{"key":"value"}`), 0644)
	if err == nil {
		t.Fatalf("AtomicWriteFile expected error")
	}
	if _, statErr := os.Stat(fileName + TempFileSuffix); !os.IsNotExist(statErr) {
		t.Fatalf("temporary file should be removed on rename error, stat err: %v", statErr)
	}
}

func TestDetectMimeTypeRecognizesSRT(t *testing.T) {
	tmpDir := t.TempDir()
	fileName := filepath.Join(tmpDir, "captions.srt")

	err := os.WriteFile(fileName, []byte("1\n00:00:01,000 --> 00:00:02,000\nHello\n"), 0644)
	if err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}

	mimeType := DetectMimeType(fileName, nil, false)
	if mimeType != "application/x-subrip" {
		t.Fatalf("DetectMimeType returned %q, expected application/x-subrip", mimeType)
	}
}

func TestDetectMimeTypeRecognizesTextSourceExtensions(t *testing.T) {
	tests := []struct {
		name     string
		expected string
	}{
		{"Component.vue", "text/x-vue"},
		{"Component.svelte", "text/x-svelte"},
		{"page.astro", "text/x-astro"},
		{"module.cts", "text/typescript"},
		{"schema.prisma", "text/x-prisma"},
		{"service.proto", "text/x-protobuf"},
		{"main.tf", "text/x-terraform"},
		{"flake.nix", "text/x-nix"},
	}

	tmpDir := t.TempDir()
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fileName := filepath.Join(tmpDir, test.name)
			err := os.WriteFile(fileName, []byte("text source\n"), 0644)
			if err != nil {
				t.Fatalf("WriteFile failed: %v", err)
			}

			mimeType := DetectMimeType(fileName, nil, false)
			if mimeType != test.expected {
				t.Fatalf("DetectMimeType returned %q, expected %q", mimeType, test.expected)
			}
		})
	}
}

func TestDetectMimeTypeRecognizesTextFileNames(t *testing.T) {
	tests := []struct {
		name     string
		expected string
	}{
		{"Dockerfile", "text/plain"},
		{"Makefile", "text/x-makefile"},
		{"Justfile", "text/plain"},
		{"Procfile", "text/plain"},
		{".env", "text/plain"},
		{".env.local", "text/plain"},
		{".env.production", "text/plain"},
		{".gitignore", "text/plain"},
		{".dockerignore", "text/plain"},
		{".editorconfig", "text/plain"},
		{".npmrc", "text/plain"},
	}

	tmpDir := t.TempDir()
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fileName := filepath.Join(tmpDir, test.name)
			err := os.WriteFile(fileName, []byte("text source\n"), 0644)
			if err != nil {
				t.Fatalf("WriteFile failed: %v", err)
			}

			mimeType := DetectMimeType(fileName, nil, false)
			if mimeType != test.expected {
				t.Fatalf("DetectMimeType returned %q, expected %q", mimeType, test.expected)
			}
		})
	}
}

func TestDetectMimeTypeWithDirEntRecognizesTextFileNames(t *testing.T) {
	tmpDir := t.TempDir()
	fileName := filepath.Join(tmpDir, "Component.vue")
	err := os.WriteFile(fileName, []byte("<template />\n"), 0644)
	if err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}

	dirEntries, err := os.ReadDir(tmpDir)
	if err != nil {
		t.Fatalf("ReadDir failed: %v", err)
	}
	if len(dirEntries) != 1 {
		t.Fatalf("expected one dir entry, got %d", len(dirEntries))
	}

	mimeType := DetectMimeTypeWithDirEnt(fileName, dirEntries[0])
	if mimeType != "text/x-vue" {
		t.Fatalf("DetectMimeTypeWithDirEnt returned %q, expected text/x-vue", mimeType)
	}
}
