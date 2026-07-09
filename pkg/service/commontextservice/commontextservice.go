// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package commontextservice

import (
	"context"
	"fmt"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/commontextstore"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

type CommonTextService struct{}

type CommonTextListRequest struct {
	Query      string   `json:"query,omitempty"`
	TagFilters []string `json:"tagFilters,omitempty"`
	Limit      int      `json:"limit,omitempty"`
	Offset     int      `json:"offset,omitempty"`
}

type CommonTextListResponse struct {
	Items []wconfig.CommonTextItemType `json:"items"`
}

type CommonTextGetRequest struct {
	ID string `json:"id"`
}

type CommonTextGetResponse struct {
	Item  wconfig.CommonTextItemType `json:"item"`
	Found bool                       `json:"found"`
}

type CommonTextTagsResponse struct {
	Tags []commontextstore.TagSummary `json:"tags"`
}

type CommonTextUpdateRequest struct {
	ID      string   `json:"id"`
	Title   *string  `json:"title,omitempty"`
	Text    *string  `json:"text,omitempty"`
	Content *string  `json:"content,omitempty"`
	Tags    []string `json:"tags,omitempty"`
	SetTags bool     `json:"setTags,omitempty"`
}

type CommonTextRenameTagRequest struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type CommonTextRenameTagResponse struct {
	Count int `json:"count"`
}

func (svc *CommonTextService) List_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "list common text items",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "common text items",
	}
}

func (svc *CommonTextService) List(ctx context.Context, request *CommonTextListRequest) (*CommonTextListResponse, error) {
	if request == nil {
		request = &CommonTextListRequest{}
	}
	items, err := commontextstore.List(ctx, commontextstore.ListOptions{
		Query:      request.Query,
		TagFilters: request.TagFilters,
		Limit:      request.Limit,
		Offset:     request.Offset,
	})
	if err != nil {
		return nil, err
	}
	return &CommonTextListResponse{Items: items}, nil
}

func (svc *CommonTextService) Get_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "get a common text item by id",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "common text item",
	}
}

func (svc *CommonTextService) Get(ctx context.Context, request *CommonTextGetRequest) (*CommonTextGetResponse, error) {
	if request == nil || strings.TrimSpace(request.ID) == "" {
		return nil, fmt.Errorf("common text id is required")
	}
	item, found, err := commontextstore.Get(ctx, request.ID)
	if err != nil {
		return nil, err
	}
	return &CommonTextGetResponse{Item: item, Found: found}, nil
}

func (svc *CommonTextService) Tags_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "list common text tags",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "common text tags",
	}
}

func (svc *CommonTextService) Tags(ctx context.Context, request *CommonTextListRequest) (*CommonTextTagsResponse, error) {
	if request == nil {
		request = &CommonTextListRequest{}
	}
	tags, err := commontextstore.ListTags(ctx, commontextstore.ListOptions{
		Query:      request.Query,
		TagFilters: request.TagFilters,
		Limit:      request.Limit,
	})
	if err != nil {
		return nil, err
	}
	return &CommonTextTagsResponse{Tags: tags}, nil
}

func (svc *CommonTextService) Update_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "update common text title, text, or tags",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "updated common text item",
	}
}

func (svc *CommonTextService) Update(ctx context.Context, request *CommonTextUpdateRequest) (*wconfig.CommonTextItemType, error) {
	if request == nil {
		return nil, fmt.Errorf("common text update request is required")
	}
	item, err := commontextstore.Update(ctx, commontextstore.UpdateRequest{
		ID:      request.ID,
		Title:   request.Title,
		Text:    request.Text,
		Content: request.Content,
		Tags:    request.Tags,
		SetTags: request.SetTags,
	})
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (svc *CommonTextService) RenameTag_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "rename a common text tag globally",
		ArgNames:   []string{"ctx", "request"},
		ReturnDesc: "common text tag rename result",
	}
}

func (svc *CommonTextService) RenameTag(ctx context.Context, request *CommonTextRenameTagRequest) (*CommonTextRenameTagResponse, error) {
	if request == nil {
		return nil, fmt.Errorf("rename tag request is required")
	}
	count, err := commontextstore.RenameTag(ctx, request.From, request.To)
	if err != nil {
		return nil, err
	}
	return &CommonTextRenameTagResponse{Count: count}, nil
}
