const special_stuff = {
    '\\alpha': 'α',
    '\\beta': 'β',
    '\\gamma': 'γ',
    '\\delta': 'δ',
    '\\epsilon': 'ε',
    '\\varepsilon': 'ε',
    '\\zeta': 'ζ',
    '\\eta': 'η',
    '\\theta': 'θ',
    '\\vartheta': 'ϑ',
    '\\iota': 'ι',
    '\\kappa': 'κ',
    '\\lambda': 'λ',
    '\\mu': 'μ',
    '\\nu': 'ν',
    '\\xi': 'ξ',
    '\\pi': 'π',
    '\\varpi': 'ϖ',
    '\\rho': 'ρ',
    '\\varrho': 'ϱ',
    '\\sigma': 'σ',
    '\\varsigma': 'ς',
    '\\tau': 'τ',
    '\\upsilon': 'υ',
    '\\phi': 'φ',
    '\\varphi': 'φ',
    '\\chi': 'χ',
    '\\psi': 'ψ',
    '\\omega': 'ω',
    '\\Gamma': 'Γ',
    '\\Delta': 'Δ',
    '\\Theta': 'Θ',
    '\\Lambda': 'Λ',
    '\\Xi': 'Ξ',
    '\\Pi': 'Π',
    '\\Sigma': 'Σ',
    '\\Upsilon': 'Υ',
    '\\Phi': 'Φ',
    '\\Psi': 'Ψ',
    '\\Omega': 'Ω',
    '\\implies': '⇒',
    '\\approx': '≈',
    '\\dot': '⋅',
    '\\forall': '∀',
    '\\exists': '∃',
    '\\leq': '≤',
    '\\geq': '≥',
};

function parse_math_notation(math_str, nested_level = 0) {
    let result = '';
    let i = 0;

    while (i < math_str.length) {
        if (math_str[i] === '_' && math_str[i + 1] === '{') {
            let j = i + 2;
            let subscript = '';
            let bracket_count = 1;

            while (j < math_str.length && bracket_count > 0) {
                if (math_str[j] === '{') {
                    bracket_count++;
                }
                if (math_str[j] === '}') {
                    bracket_count--;
                }

                if (bracket_count > 0) {
                    subscript += math_str[j];
                }
                j++;
            }

            const nest_level = nested_level + 1;
            result += '<span class="sub level-' + nest_level + '">' + parse_math_notation(subscript, nest_level) + '</span>';
            i = j;
        }
        else if (math_str[i] === '^' && math_str[i + 1] === '{') {
            let j = i + 2;
            let superscript = '';
            let bracket_count = 1;

            while (j < math_str.length && bracket_count > 0) {
                if (math_str[j] === '{') {
                    bracket_count++;
                }
                if (math_str[j] === '}') {
                    bracket_count--;
                }

                if (bracket_count > 0) {
                    superscript += math_str[j];
                }
                j++;
            }

            const nest_level = nested_level + 1;
            result += '<span class="sup level-' + nest_level + '">' + parse_math_notation(superscript, nest_level) + '</span>';
            i = j;
        }
        else if (i + 9 < math_str.length && math_str.substring(i, i + 10) === '\\leftparen') {
            i += 10;
            result += '<span class="leftparen">(</span>';
        }
        else if (i + 10 < math_str.length && math_str.substring(i, i + 11) === '\\rightparen') {
            i += 11;
            result += '<span class="rightparen">)</span>';
        }
        else if (i + 8 < math_str.length && math_str.substring(i, i + 9) === '\\integral') {
            i += 9;
            result += '<span class="integral">∫</span>';
        }
        else if (i + 5 < math_str.length && math_str.substring(i, i + 6) === '\\frac{') {
            let j = i + 6;
            let numerator = '';
            let bracket_count = 1;

            while (j < math_str.length && bracket_count > 0) {
                if (math_str[j] === '{') {
                    bracket_count++;
                }
                if (math_str[j] === '}') {
                    bracket_count--;
                }

                if (bracket_count > 0) {
                    numerator += math_str[j];
                }
                j++;
            }

            if (j < math_str.length && math_str[j] === '{') {
                let denominator = '';
                bracket_count = 1;
                j++;

                while (j < math_str.length && bracket_count > 0) {
                    if (math_str[j] === '{') {
                        bracket_count++;
                    }
                    if (math_str[j] === '}') {
                        bracket_count--;
                    }

                    if (bracket_count > 0) {
                        denominator += math_str[j];
                    }
                    j++;
                }

                const nest_level = nested_level + 1;
                result += '<span class="fraction level-' + nest_level + '"><span class="numerator">' + parse_math_notation(numerator, nest_level) + '</span><span class="denominator">' + parse_math_notation(denominator, nest_level) + '</span></span>';
                i = j;
            }
        }
        else if (math_str[i] === '*' && i + 1 < math_str.length) {
            let j = i + 1;
            let bold_text = '';
            while (j < math_str.length && math_str[j] !== '*') {
                bold_text += math_str[j];
                j++;
            }
            if (j < math_str.length && math_str[j] === '*') {
                const nest_level = nested_level + 1;
                result += '<b>' + parse_math_notation(bold_text, nest_level) + '</b>';
                i = j + 1;
            }
            else {
                result += '*';
                i++;
            }
        }
        else if (i + 6 < math_str.length && math_str.substring(i, i + 7) === '\\class{') {
            let j = i + 7;
            let class_name = '';
            let bracket_count = 1;
        
            while (j < math_str.length && bracket_count > 0) {
                if (math_str[j] === '{') {
                    bracket_count++;
                }
                if (math_str[j] === '}') {
                    bracket_count--;
                }
        
                if (bracket_count > 0) {
                    class_name += math_str[j];
                }
                j++;
            }
        
            if (j < math_str.length && math_str[j] === '{') {
                let content = '';
                bracket_count = 1;
                j++;
        
                while (j < math_str.length && bracket_count > 0) {
                    if (math_str[j] === '{') {
                        bracket_count++;
                    }
                    if (math_str[j] === '}') {
                        bracket_count--;
                    }
        
                    if (bracket_count > 0) {
                        content += math_str[j];
                    }
                    j++;
                }
        
                const nest_level = nested_level + 1;
                result += '<span class="' + class_name + '">' + parse_math_notation(content, nest_level) + '</span>';
                i = j;
            }
        }        
        else if (i + 3 < math_str.length && math_str.substring(i, i + 4) === '\\id{') {
            let j = i + 4;
            let id_name = '';
            let bracket_count = 1;
        
            while (j < math_str.length && bracket_count > 0) {
                if (math_str[j] === '{') {
                    bracket_count++;
                }
                if (math_str[j] === '}') {
                    bracket_count--;
                }
        
                if (bracket_count > 0) {
                    id_name += math_str[j];
                }
                j++;
            }
        
            if (j < math_str.length && math_str[j] === '{') {
                let content = '';
                bracket_count = 1;
                j++;
        
                while (j < math_str.length && bracket_count > 0) {
                    if (math_str[j] === '{') {
                        bracket_count++;
                    }
                    if (math_str[j] === '}') {
                        bracket_count--;
                    }
        
                    if (bracket_count > 0) {
                        content += math_str[j];
                    }
                    j++;
                }
        
                const nest_level = nested_level + 1;
                result += '<span id="' + id_name + '">' + parse_math_notation(content, nest_level) + '</span>';
                i = j;
            }
        }
        else {
            let found_special = false;

            for (const [symbol, replacement] of Object.entries(special_stuff)) {
                if (i + symbol.length <= math_str.length &&
                    math_str.substring(i, i + symbol.length) === symbol) {
                    result += replacement;
                    i += symbol.length;
                    found_special = true;
                    break;
                }
            }

            if (found_special) {
                continue;
            } else if (i + 4 < math_str.length && math_str.substring(i, i + 5) === '\\cdot') {
                result += '·';
                i += 5;
            } else if (math_str[i] === '^' && i + 1 < math_str.length && math_str[i + 1] !== '{') {
                const nest_level = nested_level + 1;
                result += '<span class="sup level-' + nest_level + '">' + math_str[i + 1] + '</span>';
                i += 2;
            } else if (math_str[i] === '_' && i + 1 < math_str.length && math_str[i + 1] !== '{') {
                const nest_level = nested_level + 1;
                result += '<span class="sub level-' + nest_level + '">' + math_str[i + 1] + '</span>';
                i += 2;
            } else {
                result += math_str[i];
                i++;
            }
        }
    }

    return result;
}

function render_all_math_elements() {
    const math_elements = document.querySelectorAll('.math');

    math_elements.forEach(element => {
        const math_notation = element.getAttribute('data');
        if(math_notation){
            const parsed_math = parse_math_notation(math_notation);

            element.innerHTML = parsed_math;
            element.classList.add('equation');
        }
    });
}

function update_math_element(element) {
    if (!element) return;

    const math_notation = element.getAttribute('data');
    if (!math_notation) return;

    const parsed_math = parse_math_notation(math_notation);
    element.innerHTML = parsed_math;
    element.classList.add('equation');
}

window.onload = function() {
    render_all_math_elements();
};