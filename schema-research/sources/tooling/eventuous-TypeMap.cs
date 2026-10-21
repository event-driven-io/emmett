// Copyright (C) Eventuous HQ OÜ. All rights reserved
// Licensed under the Apache License, Version 2.0.

using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

namespace Eventuous;

public class TypeMap<TV> {
    MapEntry[] _values = new MapEntry[RecommendedCapacity];

    public TypeMap<TV> Add<TK>(TV value) {
        var index = GetIndex<TK>();
        return !TryAdd(index, value) ? throw new Exceptions.DuplicateTypeException<TK>() : this;
    }

    public bool TryGetValue<TK>([MaybeNullWhen(false)] out TV value) {
        var index = GetIndex<TK>();

        if ((uint)index >= (uint)_values.Length) {
            value = default;
            return false;
        }

        ref var entry = ref Unsafe.Add(ref MemoryMarshal.GetArrayDataReference(_values), index);
        value = entry.Value;
        return entry.HasValue;
    }

    void EnsureCapacity(int index) {
        if ((uint)index >= (uint)_values.Length) Array.Resize(ref _values, RecommendedCapacity);
    }

    bool TryAdd(int index, TV value) {
        EnsureCapacity(index);
        ref var entry = ref Unsafe.Add(ref MemoryMarshal.GetArrayDataReference(_values), index);
        if (entry.HasValue) return false;

        entry.Value    = value;
        entry.HasValue = true;
        return true;
    }

    struct MapEntry {
        public bool HasValue { get; set; }
        public TV?  Value    { get; set; }
    }

    // ReSharper disable once InconsistentNaming
    // ReSharper disable once StaticMemberInGenericType
    static volatile int _index = -1;

    const int DefaultCapacity = 10;

    // ReSharper disable once UnusedTypeParameter
    static class TypeSlot<T> {
        // ReSharper disable once StaticMemberInGenericType
        internal static readonly int Index = Interlocked.Increment(ref _index);
    }

    static int GetIndex<TK>() => TypeSlot<TK>.Index;

    static int RecommendedCapacity {
        get {
            var capacity = _index + 1;

            if (capacity < DefaultCapacity) {
                capacity = DefaultCapacity;
            }
            else {
                capacity += DefaultCapacity;
                if ((uint)capacity > Array.MaxLength) capacity = Array.MaxLength;
            }

            return capacity;
        }
    }
}
