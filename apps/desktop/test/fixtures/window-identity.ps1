param([long]$Window)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WindowIdentity {
  [StructLayout(LayoutKind.Sequential, Pack=4)] public struct Key { public Guid format; public uint id; }
  [StructLayout(LayoutKind.Explicit, Size=24)] public struct Value {
    [FieldOffset(0)] public ushort type;
    [FieldOffset(8)] public IntPtr pointer;
  }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface Store {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int GetAt(uint index, out Key key);
    [PreserveSig] int GetValue(ref Key key, out Value value);
  }
  [DllImport("shell32.dll", PreserveSig=false)] static extern void SHGetPropertyStoreForWindow(IntPtr window, ref Guid id, [MarshalAs(UnmanagedType.Interface)] out Store store);
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref Value value);
  public static string Read(long window, uint property) {
    var id = typeof(Store).GUID;
    Store store; SHGetPropertyStoreForWindow(new IntPtr(window), ref id, out store);
    var key = new Key { format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), id=property };
    Value value; Marshal.ThrowExceptionForHR(store.GetValue(ref key, out value));
    var text = value.type == 31 ? Marshal.PtrToStringUni(value.pointer) : null;
    PropVariantClear(ref value); Marshal.ReleaseComObject(store);
    return text;
  }
}
'@
@{
  appId=[WindowIdentity]::Read($Window,5)
  command=[WindowIdentity]::Read($Window,2)
  icon=[WindowIdentity]::Read($Window,3)
  name=[WindowIdentity]::Read($Window,4)
} | ConvertTo-Json
