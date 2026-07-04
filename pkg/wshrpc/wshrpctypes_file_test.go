// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import (
    "encoding/json"
    "testing"
)

func TestFileInfoMarshalsEmptyMimeType(t *testing.T) {
    data, err := json.Marshal(FileInfo{Path: "/home/nita/.ssh/config"})
    if err != nil {
        t.Fatalf("json.Marshal failed: %v", err)
    }

    if string(data) != `{"path":"/home/nita/.ssh/config","mimetype":""}` {
        t.Fatalf("unexpected json: %s", string(data))
    }
}
