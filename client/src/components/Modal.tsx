import { useEffect, useState, useCallback } from 'react';

// ── 全局弹窗管理 ──
type AlertFn = (msg: string) => void;
type ConfirmFn = (msg: string) => Promise<boolean>;

let showAlert: AlertFn = () => {};
let showConfirm: ConfirmFn = async () => false;

/**
 * 全局弹窗容器（放在 App 根级别）。
 */
export function ModalContainer() {
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const [confirmResolve, setConfirmResolve] = useState<((v: boolean) => void) | null>(null);

  useEffect(() => {
    showAlert = (msg: string) => {
      setConfirmMsg(null);
      setAlertMsg(msg);
    };
    showConfirm = (msg: string) => {
      return new Promise<boolean>((resolve) => {
        setAlertMsg(null);
        setConfirmMsg(msg);
        setConfirmResolve(() => resolve);
      });
    };
  }, []);

  const handleConfirm = useCallback((result: boolean) => {
    setConfirmMsg(null);
    confirmResolve?.(result);
  }, [confirmResolve]);

  return (
    <>
      {/* 提示弹窗 */}
      {alertMsg && (
        <div className="modal-overlay" onClick={() => setAlertMsg(null)}>
          <div className="modal-content modal-alert" onClick={e => e.stopPropagation()}>
            <p>{alertMsg}</p>
            <button className="btn-primary" onClick={() => setAlertMsg(null)}>确定</button>
          </div>
        </div>
      )}
      {/* 确认弹窗 */}
      {confirmMsg && (
        <div className="modal-overlay" onClick={() => handleConfirm(false)}>
          <div className="modal-content modal-confirm" onClick={e => e.stopPropagation()}>
            <p>{confirmMsg}</p>
            <div className="confirm-buttons">
              <button className="confirm-btn confirm-yes" onClick={() => handleConfirm(true)}>确定</button>
              <button className="confirm-btn confirm-no" onClick={() => handleConfirm(false)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** 全局提示弹窗（替代 alert） */
export function modalAlert(msg: string) {
  showAlert(msg);
}

/** 全局确认弹窗（替代 confirm） */
export function modalConfirm(msg: string): Promise<boolean> {
  return showConfirm(msg);
}
