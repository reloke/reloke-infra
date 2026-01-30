# 🚀 Guide d'installation - Projet WorldMeYou (Angular 17)

## 📋 Prérequis

Avant de commencer, assurez-vous d'avoir :

- ✅ **Node.js** version 18.x ou 20.x installé
  ```bash
  node -v
  # Doit afficher v18.x.x ou v20.x.x
  ```
  
- ✅ **npm** (installé automatiquement avec Node.js)
  ```bash
  npm -v
  # Doit afficher 9.x.x ou 10.x.x
  ```

- ✅ **Git** installé
  ```bash
  git --version
  ```

> ⚠️ **Si vous n'avez pas Node.js 18 ou 20**, téléchargez-le ici : https://nodejs.org/

---

## 🔧 Étape 1 : Installation d'Angular CLI 17

Angular CLI est l'outil en ligne de commande pour gérer les projets Angular.

```bash
# Installer Angular CLI version 17 globalement
npm install -g @angular/cli@17.3.0

# Vérifier l'installation
ng version
```

Vous devriez voir quelque chose comme :
```
Angular CLI: 17.3.0
Node: 18.x.x
Package Manager: npm 9.x.x
```

---

## 📦 Étape 2 : Récupérer le projet depuis GitHub

### Option A : Via HTTPS (recommandé pour débutants)

```bash
# 1. Naviguer vers le dossier où vous voulez cloner le projet
cd C:\Users\VotreNom\Documents

# 2. Cloner le repository
git clone https://github.com/VOTRE_USERNAME/worldmeyou-front.git

# 3. Entrer dans le dossier du projet
cd worldmeyou-front
```

### Option B : Via SSH (si vous avez configuré les clés SSH)

```bash
git clone git@github.com:VOTRE_USERNAME/worldmeyou-front.git
cd worldmeyou-front
```

---

## 📥 Étape 3 : Installation des dépendances

Une fois dans le dossier du projet :

```bash
# Installer toutes les dépendances du projet
npm install
```

⏳ **Cette étape peut prendre 5-10 minutes** selon votre connexion internet.

### ⚠️ Si vous rencontrez des erreurs de dépendances

Essayez avec l'option `--legacy-peer-deps` :

```bash
npm install --legacy-peer-deps
```

---

## 🔑 Étape 4 : Configuration de l'environnement

### Si le projet nécessite des variables d'environnement :

1. Vérifiez s'il existe un fichier `.env.example` ou `environment.example.ts`
2. Copiez-le et renommez-le :
   ```bash
   # Windows (PowerShell)
   Copy-Item .env.example .env
   
   # macOS/Linux
   cp .env.example .env
   ```
3. Ouvrez le fichier `.env` et remplissez les valeurs nécessaires
4. **Demandez au chef de projet les clés API et configurations secrètes**

---

## 🚀 Étape 5 : Lancer le projet en développement

```bash
# Démarrer le serveur de développement
ng serve
```

ou

```bash
npm start
```

Vous devriez voir :

```
✔ Browser application bundle generation complete.
** Angular Live Development Server is listening on localhost:4200 **
```

🎉 **Ouvrez votre navigateur à l'adresse : http://localhost:4200**

---

## 🛠️ Commandes utiles

| Commande | Description |
|----------|-------------|
| `ng serve` | Lance le serveur de développement |
| `ng build` | Compile le projet pour la production |
| `ng test` | Lance les tests unitaires |
| `ng generate component nom` | Crée un nouveau composant |
| `npm install` | Réinstalle les dépendances |

---

## ❌ Résolution des problèmes courants

### Problème 1 : Port 4200 déjà utilisé

```bash
# Utiliser un autre port
ng serve --port 4300
```

### Problème 2 : Erreurs de compilation TypeScript

```bash
# Nettoyer et réinstaller
rm -rf node_modules package-lock.json
npm cache clean --force
npm install --legacy-peer-deps
```

### Problème 3 : Erreurs Tailwind CSS "unknown utility class"

Le projet utilise **Tailwind CSS v2.2.19**. Vérifiez que votre `tailwind.config.js` ressemble à :

```javascript
module.exports = {
  purge: [
    "./src/**/*.{html,ts}",
  ],
  darkMode: false,
  theme: {
    extend: {},
  },
  variants: {
    extend: {},
  },
  plugins: [],
}
```

### Problème 4 : Version de Node incorrecte

Si vous avez une mauvaise version de Node :

```bash
# Vérifier votre version
node -v

# Si besoin, installez nvm (Node Version Manager)
# Windows: https://github.com/coreybutler/nvm-windows
# macOS/Linux: https://github.com/nvm-sh/nvm

# Puis installer Node 18
nvm install 18
nvm use 18
```

---

## 📁 Structure du projet

```
worldmeyou-front/
├── src/
│   ├── app/              # Code de l'application
│   ├── assets/           # Images, fonts, etc.
│   ├── environments/     # Configuration environnement
│   └── styles.scss       # Styles globaux
├── node_modules/         # Dépendances (ne pas modifier)
├── angular.json          # Configuration Angular
├── package.json          # Liste des dépendances
├── tailwind.config.js    # Configuration Tailwind
└── tsconfig.json         # Configuration TypeScript
```

---

## 🔄 Workflow de développement

### 1. Avant de commencer à coder

```bash
# Récupérer les dernières modifications
git pull origin main
```

### 2. Créer une nouvelle branche pour votre feature

```bash
# Créer et basculer sur une nouvelle branche
git checkout -b feature/nom-de-votre-feature
```

### 3. Après avoir codé

```bash
# Voir les fichiers modifiés
git status

# Ajouter vos modifications
git add .

# Créer un commit avec un message clair
git commit -m "feat: description de votre fonctionnalité"

# Pousser vers GitHub
git push origin feature/nom-de-votre-feature
```

### 4. Créer une Pull Request sur GitHub

Allez sur GitHub et créez une Pull Request pour faire réviser votre code.

---

## 📚 Technologies utilisées

- **Angular 17.3.0** - Framework frontend
- **PrimeNG 17.18.0** - Bibliothèque de composants UI
- **Tailwind CSS 2.2.19** - Framework CSS
- **RxJS 7.8.1** - Programmation réactive
- **TypeScript 5.4.2** - Langage

---

## 🆘 Besoin d'aide ?

- 📖 Documentation Angular : https://angular.io/docs
- 🎨 Documentation PrimeNG : https://primeng.org/
- 💬 Contactez le chef de projet pour toute question

---

## ✅ Checklist de vérification

Avant de dire "ça marche", vérifiez que :

- [ ] `ng version` affiche Angular CLI 17.3.0
- [ ] `npm install` s'est terminé sans erreur
- [ ] `ng serve` démarre sans erreur
- [ ] Le navigateur affiche la page sur http://localhost:4200
- [ ] Vous pouvez vous connecter (si applicable)
- [ ] Aucune erreur dans la console du navigateur (F12)

---

🎉 **Félicitations ! Vous êtes prêt à développer !**
