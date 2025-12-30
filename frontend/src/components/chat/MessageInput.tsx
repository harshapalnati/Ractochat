"use client";

import { useState } from "react";

type Props = {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

export function MessageInput({ onSend, disabled, placeholder }: Props) {
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || disabled) return;
    onSend(value);
    setValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <textarea
        className="w-full resize-none bg-transparent px-2 py-2 text-sm text-white placeholder-gray-500 focus:outline-none"
        value={value}
        placeholder={placeholder ?? "Type your message..."}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        style={{ minHeight: "44px" }}
      />
      <div className="sr-only">
        <button type="submit" disabled={disabled || !value.trim()}>Send</button>
      </div>
    </form>
  );
}
