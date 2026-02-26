import { createContext, useContext, useState } from "react";

export interface GoogleUser {
    name: string;
    email: string;
    picture: string;
}

interface AuthContextValue {
    user: GoogleUser | null;
    signIn: (user: GoogleUser) => void;
    signOut: () => void;
}

const STORAGE_KEY = "shellnews_google_user";

function loadStoredUser(): GoogleUser | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as GoogleUser) : null;
    } catch {
        return null;
    }
}

const AuthContext = createContext<AuthContextValue>({
    user: null,
    signIn: () => {},
    signOut: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<GoogleUser | null>(loadStoredUser);

    function signIn(u: GoogleUser) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
        setUser(u);
    }

    function signOut() {
        localStorage.removeItem(STORAGE_KEY);
        setUser(null);
    }

    return (
        <AuthContext.Provider value={{ user, signIn, signOut }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
