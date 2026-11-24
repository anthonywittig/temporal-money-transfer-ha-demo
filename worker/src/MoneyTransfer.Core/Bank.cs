namespace MoneyTransfer.Core;

/// <summary>
/// In-process simulated bank. Each operation is keyed by an idempotency key, so a
/// retried step never moves money twice. State lives in memory per process: this is
/// a demo simplification, not durable idempotency.
/// </summary>
public class Bank
{
    public const decimal StartingBalance = 1_000_000m;

    private readonly object gate = new();
    private readonly Dictionary<string, decimal> balances = new();
    private readonly HashSet<string> appliedKeys = new();

    /// <summary>Applies the operation once per key. Returns false if the key was already applied.</summary>
    public bool Apply(string idempotencyKey, string account, decimal delta)
    {
        lock (gate)
        {
            if (appliedKeys.Contains(idempotencyKey))
            {
                return false;
            }
            var balance = BalanceUnlocked(account);
            if (balance + delta < 0)
            {
                throw new InsufficientFundsException(account, balance, -delta);
            }
            balances[account] = balance + delta;
            appliedKeys.Add(idempotencyKey);
            return true;
        }
    }

    public decimal Balance(string account)
    {
        lock (gate)
        {
            return BalanceUnlocked(account);
        }
    }

    private decimal BalanceUnlocked(string account) =>
        balances.TryGetValue(account, out var b) ? b : StartingBalance;
}

public class InsufficientFundsException(string account, decimal balance, decimal requested)
    : Exception($"Account {account} has {balance}, cannot withdraw {requested}");
