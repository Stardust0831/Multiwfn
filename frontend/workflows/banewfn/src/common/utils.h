#ifndef UTILS_H
#define UTILS_H

#include <cstddef>
#include <map>
#include <string>
#include <vector>

/**
 * @brief BaneWfn variable and placeholder grammar shared by input/config/CLI layers.
 *
 * Keeping these rules in one place prevents the three parsers from accepting subtly
 * different forms of the same variable name or placeholder.
 */
namespace VariableSyntax {

struct Placeholder {
    std::size_t begin = 0;
    std::size_t end = 0;
    std::string name;
    std::string defaultValue;
    bool braced = false;
};

bool parseNextPlaceholder(const std::string& text, std::size_t startPos, Placeholder& out);
bool isPlainVariableName(const std::string& name);
bool isListVariableName(const std::string& name, std::string* baseName = nullptr);
bool isLengthVariableName(const std::string& name, std::string* baseName = nullptr);
bool parseIndexedVariableName(const std::string& name, std::string* baseName, int* index);
bool isValidCustomVariableName(const std::string& name);
std::string serializeListValues(const std::vector<std::string>& values);

} // namespace VariableSyntax

/**
 * @brief 通用工具类，包含字符串处理、文件操作等常用功能
 */
class Utils {
public:
    /**
     * @brief 去除字符串首尾的空白字符
     * @param str 输入字符串
     * @return 去除空白字符后的字符串
     */
    static std::string trim(const std::string& str);

    /**
     * @brief Convert ASCII letters to lower case without locale-dependent behavior.
     */
    static std::string toLowerAscii(const std::string& str);

    /**
     * @brief Parse a non-negative decimal integer without partial matches or overflow.
     */
    static bool tryParseNonNegativeInt(const std::string& text, int& value);

    /**
     * @brief 去除字符串首尾的引号
     * @param str 输入字符串
     * @return 去除引号后的字符串
     */
    static std::string trimQuotes(const std::string& str);

    /**
     * @brief 按指定分隔符分割字符串
     * @param str 输入字符串
     * @param delimiter 分隔符
     * @return 分割后的字符串向量
     */
    static std::vector<std::string> split(const std::string& str, char delimiter);

    /**
     * @brief 检查文件是否存在
     * @param filepath 文件路径
     * @return 文件存在返回true，否则返回false
     */
    static bool fileExists(const std::string& filepath);

    /**
     * @brief 验证文件是否存在（别名函数，保持向后兼容）
     * @param filepath 文件路径
     * @return 文件存在返回true，否则返回false
     */
    static bool validateFile(const std::string& filepath);

    /**
     * @brief Extract the filename without directory and final extension.
     */
    static std::string getBaseName(const std::string& filepath);

    /**
     * @brief 去除字符串中的行内注释（# 及其后面），但保留以下情况：
     *        - 引号内的 # 视为普通字符（支持 '...' 与 "..."）
     *        - 使用 \# 可转义字面 #（只在引号外生效）
     * @param str 输入字符串
     * @return 去除行内注释后的字符串（并已去首尾空白）
     */
    static std::string removeInlineComment(const std::string& str);

    /**
     * @brief 展开通配符模式，返回匹配的文件列表
     * @param pattern 包含通配符的文件路径模式（如 "*.fchk"）
     * @return 匹配的文件路径列表（按字母顺序排序）
     */
    static std::vector<std::string> expandWildcard(const std::string& pattern);

    /**
     * @brief 解析bash数组语法，如 "state=(1 2 3 4 5)" 或 "(1 2 3 4 5)"
     * @param value 输入字符串，可能是数组语法或普通值
     * @return 如果是数组语法，返回解析后的字符串向量；否则返回包含单个元素的向量
     */
    static std::vector<std::string> parseBashArray(const std::string& value);

    /**
     * @brief 将多个数组变量展开为笛卡尔积组合
     * @param vars 变量映射；长度大于 1 的值向量视为数组变量
     * @return 每个组合对应一份变量映射，其中数组变量会被收敛为当前组合中的单个值
     */
    static std::vector<std::map<std::string, std::vector<std::string>>> expandVariableCombinations(
        const std::map<std::string, std::vector<std::string>>& vars);

    /**
     * @brief 解析命令行参数字符串，支持引号保护
     * @param argsStr 包含多个参数的字符串，如 "-silent -nt 4"
     * @return 解析后的参数向量
     */
    static std::vector<std::string> parseCommandLineArgs(const std::string& argsStr);
};

#endif // UTILS_H
